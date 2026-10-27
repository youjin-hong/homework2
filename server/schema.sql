CREATE TABLE IF NOT EXISTS jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  worker_id VARCHAR(50) NULL,
  duration_ms INT NOT NULL,
  should_fail TINYINT(1) NOT NULL DEFAULT 0,
  result_message VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS job_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  job_id INT NOT NULL,
  event VARCHAR(30) NOT NULL,
  worker_id VARCHAR(50) NULL,
  message VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_job_events_job_id (job_id)
);
