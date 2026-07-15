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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColorSet {
    pub id: String,
    pub name: String,
    pub color: i64, // ARGB
    pub sort_order: f64,
}
