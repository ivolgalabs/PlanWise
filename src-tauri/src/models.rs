use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
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
