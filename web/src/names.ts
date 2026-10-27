// 화면에서만 쓰는 이름 (코드와 WORKER_ID는 worker-1~3 그대로)
export const WORKERS = [
  { workerId: 'worker-1', name: 'Worker 1' },
  { workerId: 'worker-2', name: 'Worker 2' },
  { workerId: 'worker-3', name: 'Worker 3' },
]

// 서버의 JOB_TYPES와 같은 처리 시간 (버튼 표시용)
export const JOB_TYPES = [
  { type: 'A', seconds: 6 },
  { type: 'B', seconds: 10 },
  { type: 'C', seconds: 15 },
]

export function workerName(workerId: string | null) {
  if (!workerId) return null
  return WORKERS.find((worker) => worker.workerId === workerId)?.name ?? workerId
}
