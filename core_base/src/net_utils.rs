#[cfg(feature = "net")]
pub struct NetClient {
    client: reqwest::Client,
}

#[cfg(feature = "net")]
impl NetClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    pub async fn fetch_json<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
    ) -> Result<T, reqwest::Error> {
        let response = self.client.get(url).send().await?;
        let data = response.json::<T>().await?;
        Ok(data)
    }
}

#[cfg(feature = "net")]
impl Default for NetClient {
    fn default() -> Self {
        Self::new()
    }
}
