import { useCallback, useState } from 'react'
import type { Job } from './types'

// 파이프라인에서 작업이 놓이는 자리
// front, nginx, master-in, master-out, events, db 구간은 순식간이라 화면에서 보여 주는 연출이고,
// jobs 큐 대기와 worker 처리 중은 DB 상태를 그대로 따른다
export type Stage = string

export function stageOf(job: Job, flight: Stage | undefined, fallen: Record<string, boolean>): Stage {
  if (flight) return flight
  if (job.status === 'queued') return 'jobs'
  if (job.status === 'started') {
    // 장애가 난 워커가 들고 있던 작업은 브로커에서 jobs 큐로 돌아간다
    return job.workerId && !fallen[job.workerId] ? `worker:${job.workerId}` : 'jobs'
  }
  return 'result'
}

export function useFlights() {
  const [flights, setFlights] = useState<Record<number, Stage>>({})

  const run = useCallback((jobId: number, stages: Stage[], gapMs = 550) => {
    stages.forEach((stage, i) => {
      setTimeout(() => setFlights((prev) => ({ ...prev, [jobId]: stage })), i * gapMs)
    })
    setTimeout(() => {
      setFlights((prev) => {
        const next = { ...prev }
        delete next[jobId]
        return next
      })
    }, stages.length * gapMs)
  }, [])

  return { flights, run }
}
