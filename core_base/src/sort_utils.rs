//! Утилиты сортировки строк.
//!
//! Natural (natural-order) сравнение: числовые подстроки сравниваются как числа,
//! поэтому "page2" < "page10" (в отличие от лексикографического порядка).

use std::cmp::Ordering;

/// Расширение-трейт для natural-order сравнения строк.
pub trait NaturalCmp {
    /// Сравнить две строки в natural order (`page2` < `page10`).
    fn natural_cmp(&self, other: &str) -> Ordering;
}

impl NaturalCmp for str {
    fn natural_cmp(&self, other: &str) -> Ordering {
        natural_cmp(self, other)
    }
}

impl NaturalCmp for String {
    fn natural_cmp(&self, other: &str) -> Ordering {
        natural_cmp(self.as_str(), other)
    }
}

/// Natural-order сравнение двух строковых срезов.
///
/// Строка разбивается на чередующиеся не-цифровые и цифровые участки; цифровые
/// участки сравниваются как числа любой длины, остальные — посимвольно без учёта
/// регистра ASCII. Это даёт интуитивный порядок имён файлов/страниц.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let mut ai = a.chars().peekable();
    let mut bi = b.chars().peekable();
    loop {
        match (ai.peek(), bi.peek()) {
            // Равны по смыслу ("01" и "1") — короче раньше, как в Kotlin-копии ComiFlow.
            (None, None) => return a.len().cmp(&b.len()),
            (None, _) => return Ordering::Less,
            (_, None) => return Ordering::Greater,
            (Some(&ac), Some(&bc)) => {
                let ac_d = ac.is_ascii_digit();
                let bc_d = bc.is_ascii_digit();
                if ac_d && bc_d {
                    // Поглощаем целые числовые группы и сравниваем как числа.
                    let mut a_num = String::new();
                    let mut b_num = String::new();
                    while let Some(&c) = ai.peek() {
                        if c.is_ascii_digit() {
                            a_num.push(c);
                            ai.next();
                        } else {
                            break;
                        }
                    }
                    while let Some(&c) = bi.peek() {
                        if c.is_ascii_digit() {
                            b_num.push(c);
                            bi.next();
                        } else {
                            break;
                        }
                    }
                    // По значению без u64: без ведущих нулей короче = меньше, равная
                    // длина — посимвольно. Числа длиннее 20 цифр раньше парсились в 0.
                    let at = a_num.trim_start_matches('0');
                    let bt = b_num.trim_start_matches('0');
                    match at.len().cmp(&bt.len()).then_with(|| at.cmp(bt)) {
                        Ordering::Equal => continue,
                        ord => return ord,
                    }
                } else {
                    match ac.to_ascii_lowercase().cmp(&bc.to_ascii_lowercase()) {
                        Ordering::Equal => {
                            ai.next();
                            bi.next();
                            continue;
                        }
                        ord => return ord,
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numeric_order() {
        assert_eq!(natural_cmp("page2", "page10"), Ordering::Less);
        assert_eq!(natural_cmp("page10", "page2"), Ordering::Greater);
        assert_eq!(natural_cmp("page2", "page2"), Ordering::Equal);
        assert_eq!(natural_cmp("000", "001"), Ordering::Less);
        assert_eq!(natural_cmp("1", "01"), Ordering::Less);
        assert_eq!(
            natural_cmp("p99999999999999999999999", "p100000000000000000000000"),
            Ordering::Less
        );
    }

    #[test]
    fn case_insensitive() {
        assert_eq!(natural_cmp("Img", "img"), Ordering::Equal);
        assert_eq!(natural_cmp("IMG", "img"), Ordering::Equal);
    }

    #[test]
    fn sorts_vec_naturally() {
        let mut v = vec!["p10", "p2", "p1"];
        v.sort_by(|a, b| a.natural_cmp(b));
        assert_eq!(v, vec!["p1", "p2", "p10"]);
    }
}
