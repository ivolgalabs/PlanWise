use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub date: i64, // epoch-day
    pub is_done: bool,
    pub color_set_id: Option<String>,
    pub sort_order: f64,
    pub created_at: i64, // epoch-ms
    pub updated_at: i64, // epoch-ms
    pub device_id: String,
    #[serde(default)]
    pub time_minutes: Option<i32>, // 0-1439, NULL = «в течение дня»
    #[serde(default)]
    pub notes: String, // заметка к задаче, '' = нет
    #[serde(default)]
    pub someday: bool, // «Когда-нибудь»: задача без привязки ко дню
    #[serde(default)]
    pub archived: bool, // «Архив»: задача скрыта из видов, ждёт возврата
    #[serde(default)]
    pub travel_time: Option<i32>, // минуты на дорогу (выехать заранее)
    #[serde(default)]
    pub duration_minutes: Option<i32>, // сколько длится выполнение (мин)
    #[serde(default)]
    pub difficulty: i32, // «класс» задачи: 0=не задана, 1=лёгкая, 2=средняя, 3=сложная
    #[serde(default)]
    pub notify_minutes: Option<i32>, // своё уведомление: NULL=по умолчанию, 0=нет, N=за N мин
    #[serde(default)]
    pub travel_notify_minutes: Option<i32>, // напомнить за N мин до выезда; NULL = не напоминать
    #[serde(default)]
    pub due_epoch_day: Option<i64>, // «Когда-нибудь»: мягкий срок (epoch-day); NULL = без срока
    #[serde(default)]
    pub done_at: Option<i64>, // когда закрыта (epoch-ms); ведёт БД (триггер V15)
    #[serde(default)]
    pub dropped_at: Option<i64>, // «отпущена» (epoch-ms); такая задача и is_done = true
    #[serde(default)]
    pub postpone_count: i32, // сколько раз перенесена с сегодня/прошлого на будущее
    #[serde(default)]
    pub repeat: Option<String>, // повтор: daily | weekly | monthly; NULL = разовая
}

/// День как страница: заметка «как прошёл день» и отметка «день закрыт».
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    pub epoch_day: i64,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub closed_at: Option<i64>,
    #[serde(default)]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorSet {
    pub id: String,
    pub name: String,
    pub color: i64, // ARGB
    pub sort_order: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subtask {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub is_done: bool,
    pub sort_order: f64,
    pub created_at: i64,
}

/// Вложение заметки: файл, прикреплённый к задаче. Сам файл лежит в
/// app_data_dir/files/attachments/<stored_name>; в БД — метаданные.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub task_id: String,
    pub file_name: String,
    pub mime: String,
    pub size: i64,
    pub created_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Старый JSON без поля notes (фоллбек, старые бэкапы) десериализуется
    /// в пустую строку за счёт #[serde(default)].
    #[test]
    fn task_deserializes_without_notes() {
        let t: Task = serde_json::from_value(serde_json::json!({
            "id": "a",
            "title": "T",
            "date": 0,
            "isDone": false,
            "colorSetId": null,
            "sortOrder": 0.0,
            "createdAt": 0,
            "updatedAt": 0,
            "deviceId": "d",
            "timeMinutes": null,
        }))
        .expect("parse task without notes");
        assert_eq!(t.notes, "");
    }

    /// Старый JSON без someday десериализуется в false.
    #[test]
    fn task_deserializes_without_someday() {
        let t: Task = serde_json::from_value(serde_json::json!({
            "id": "a", "title": "T", "date": 0, "isDone": false,
            "colorSetId": null, "sortOrder": 0.0, "createdAt": 0,
            "updatedAt": 0, "deviceId": "d", "timeMinutes": null,
            "notes": "",
        }))
        .expect("parse task without someday");
        assert!(!t.someday);
    }

    /// Старый JSON без archived десериализуется в false.
    #[test]
    fn task_deserializes_without_archived() {
        let t: Task = serde_json::from_value(serde_json::json!({
            "id": "a", "title": "T", "date": 0, "isDone": false,
            "colorSetId": null, "sortOrder": 0.0, "createdAt": 0,
            "updatedAt": 0, "deviceId": "d", "timeMinutes": null,
            "notes": "", "someday": false,
        }))
        .expect("parse task without archived");
        assert!(!t.archived);
    }
}
