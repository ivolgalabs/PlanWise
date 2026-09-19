//! Изоляция паник и перезапуск долгоживущих фоновых задач.
//!
//! Зачем: задача, запущенная через `spawn`, умирает молча — паника внутри неё
//! печатается в stderr (которого в релизе нет) и фон просто перестаёт работать:
//! приём соединений, наблюдатель за файлами, планировщик. Здесь две обёртки:
//!
//! - [`guard`] — задача выполняется один раз, паника ловится и попадает в журнал
//!   (приложение продолжает работать, причина видна в отчёте о сбое);
//! - [`supervise`] — задача перезапускается с экспоненциальной паузой.
//!
//! Обе — `async fn`: внешний запуск остаётся за вызывающим (`tauri::async_runtime::spawn`
//! или `tokio::spawn`), потому что `tokio::spawn` требует уже запущенного рантайма.

use std::future::Future;
use std::time::Duration;

use crate::diagnostics;

/// Политика перезапуска: пауза растёт вдвое от `initial` до `max`.
#[derive(Debug, Clone, Copy)]
pub struct Policy {
    pub initial: Duration,
    pub max: Duration,
}

impl Default for Policy {
    fn default() -> Self {
        Self {
            initial: Duration::from_secs(1),
            max: Duration::from_secs(30),
        }
    }
}

/// Пауза перед `attempt`-м перезапуском (нумерация с 1): 1с, 2с, 4с… но не больше `max`.
/// Экспонента нужна, чтобы задача, падающая сразу (нет сети, занят порт), не крутилась
/// в горячем цикле и не съедала ядро.
pub fn next_delay(policy: &Policy, attempt: u32) -> Duration {
    let shift = attempt.saturating_sub(1).min(16);
    let factor = 1u32 << shift;
    policy
        .initial
        .saturating_mul(factor)
        .min(policy.max)
        .max(policy.initial)
}

/// Выполнить задачу один раз, поймав панику. Паника не уходит наружу и не роняет
/// приложение — она записывается в журнал диагностики.
pub async fn guard<F>(name: &'static str, task: F)
where
    F: Future<Output = ()> + Send + 'static,
{
    // Вложенный spawn: паника возвращается как JoinError, а не разматывает стек вызывающего.
    match tokio::spawn(task).await {
        Ok(()) => diagnostics::record(format!("задача «{name}» завершилась")),
        Err(e) => diagnostics::record(format!("задача «{name}» упала: {e}")),
    }
}

/// Выполнять задачу, перезапуская её после паники с растущей паузой. Штатное
/// завершение (задача вернула управление) — не паника: перезапуска нет.
pub async fn supervise<F, Fut>(name: &'static str, factory: F)
where
    F: Fn() -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    supervise_with(name, Policy::default(), factory).await
}

/// То же, но с явной политикой (нужна там, где 30 секунд — слишком долго ждать,
/// и в тестах).
pub async fn supervise_with<F, Fut>(name: &'static str, policy: Policy, factory: F)
where
    F: Fn() -> Fut + Send + 'static,
    Fut: Future<Output = ()> + Send + 'static,
{
    let mut attempt: u32 = 0;
    loop {
        match tokio::spawn(factory()).await {
            Ok(()) => {
                diagnostics::record(format!("задача «{name}» завершилась штатно"));
                return;
            }
            Err(e) => {
                attempt = attempt.saturating_add(1);
                let delay = next_delay(&policy, attempt);
                diagnostics::record(format!(
                    "задача «{name}» упала ({e}), перезапуск №{attempt} через {} мс",
                    delay.as_millis()
                ));
                tokio::time::sleep(delay).await;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn next_delay_grows_and_stops_at_max() {
        let policy = Policy {
            initial: Duration::from_millis(100),
            max: Duration::from_millis(500),
        };
        assert_eq!(next_delay(&policy, 1), Duration::from_millis(100));
        assert_eq!(next_delay(&policy, 2), Duration::from_millis(200));
        assert_eq!(next_delay(&policy, 3), Duration::from_millis(400));
        assert_eq!(next_delay(&policy, 4), Duration::from_millis(500));
        assert_eq!(next_delay(&policy, 50), Duration::from_millis(500));
        // Нулевая попытка не должна давать нулевую паузу (горячий цикл).
        assert_eq!(next_delay(&policy, 0), Duration::from_millis(100));
    }

    #[tokio::test]
    async fn guard_survives_panic_and_returns() {
        // Паника внутри задачи не должна уронить тест: guard её поглощает.
        guard("падающая", async {
            panic!("тестовая паника в задаче")
        })
        .await;
    }

    #[tokio::test]
    async fn guard_returns_when_task_finishes_normally() {
        let done = Arc::new(AtomicUsize::new(0));
        let flag = Arc::clone(&done);
        guard("обычная", async move {
            flag.fetch_add(1, Ordering::SeqCst);
        })
        .await;
        assert_eq!(done.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn supervise_restarts_after_panic() {
        let runs = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&runs);
        let handle = tokio::spawn(supervise_with(
            "перезапускаемая",
            Policy {
                initial: Duration::from_millis(5),
                max: Duration::from_millis(10),
            },
            move || {
                let counter = Arc::clone(&counter);
                async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                    panic!("падаю всегда");
                }
            },
        ));
        let deadline = tokio::time::Instant::now() + Duration::from_millis(1000);
        while runs.load(Ordering::SeqCst) < 3 && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        handle.abort();
        let total = runs.load(Ordering::SeqCst);
        assert!(
            total >= 3,
            "задача перезапускалась {total} раз(а), ожидалось ≥3"
        );
    }

    #[tokio::test]
    async fn supervise_does_not_restart_on_normal_finish() {
        let runs = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&runs);
        supervise_with(
            "завершающаяся",
            Policy {
                initial: Duration::from_millis(1),
                max: Duration::from_millis(2),
            },
            move || {
                let counter = Arc::clone(&counter);
                async move {
                    counter.fetch_add(1, Ordering::SeqCst);
                }
            },
        )
        .await;
        assert_eq!(runs.load(Ordering::SeqCst), 1);
    }
}
