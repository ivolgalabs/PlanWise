#[cfg(feature = "net")]
pub struct NetClient {
    client: reqwest::Client,
}

#[cfg(feature = "net")]
#[derive(Debug, thiserror::Error)]
pub enum DownloadError {
    #[error("network: {0}")]
    Net(#[from] reqwest::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

#[cfg(feature = "net")]
impl NetClient {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    /// Wrap a pre-configured client (custom TLS backend, User-Agent, timeouts).
    pub fn with_client(client: reqwest::Client) -> Self {
        Self { client }
    }

    /// Remote file size via HEAD, if the server reports it.
    pub async fn content_length(&self, url: &str) -> Result<Option<u64>, reqwest::Error> {
        let response = self.client.head(url).send().await?;
        Ok(response.content_length())
    }

    /// Stream a URL into a file, calling progress(done, total) per chunk.
    /// Constant memory regardless of file size (the ~95 MB flyer PDFs
    /// motivated this — fetch_bytes would hold them all in RAM).
    pub async fn download_file<F: FnMut(u64, u64) + Send>(
        &self,
        url: &str,
        path: &std::path::Path,
        mut progress: F,
    ) -> Result<u64, DownloadError> {
        use std::io::Write;

        let mut response = self.client.get(url).send().await?.error_for_status()?;
        let total = response.content_length().unwrap_or(0);
        let mut file = std::fs::File::create(path)?;
        let mut done: u64 = 0;
        while let Some(chunk) = response.chunk().await? {
            file.write_all(&chunk)?;
            done += chunk.len() as u64;
            progress(done, total);
        }
        file.flush()?;
        Ok(done)
    }

    pub async fn fetch_json<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
    ) -> Result<T, reqwest::Error> {
        let response = self.client.get(url).send().await?;
        let data = response.json::<T>().await?;
        Ok(data)
    }

    pub async fn fetch_text(&self, url: &str) -> Result<String, reqwest::Error> {
        let response = self.client.get(url).send().await?;
        response.text().await
    }

    pub async fn post_json<B: serde::Serialize, T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
        body: &B,
    ) -> Result<T, reqwest::Error> {
        let response = self.client.post(url).json(body).send().await?;
        response.json::<T>().await
    }

    pub async fn fetch_bytes(&self, url: &str) -> Result<Vec<u8>, reqwest::Error> {
        let response = self.client.get(url).send().await?;
        let bytes = response.bytes().await?;
        Ok(bytes.to_vec())
    }
}

#[cfg(feature = "net")]
impl Default for NetClient {
    fn default() -> Self {
        Self::new()
    }
}
