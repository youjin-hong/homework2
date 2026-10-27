import { useCallback, useEffect, useRef, useState } from 'react'
import { useFlights } from './flights'
import { JOB_TYPES, workerName } from './names'
import Pipeline from './Pipeline'
import type { Job } from './types'

type JobEvent = {
  event: string
  workerId: string | null
  message: string | null
  createdAt: string
}

const isDone = (job: Job) => job.status === 'completed' || job.status === 'failed'
const timeOf = (createdAt: string) => createdAt.slice(11, 19)

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [shouldFail, setShouldFail] = useState(false)
  const [notice, setNotice] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [events, setEvents] = useState<JobEvent[]>([])
  const { flights, run } = useFlights()
  const prevStatus = useRef<Record<number, string>>({})
  const [fallen, setFallen] = useState<Record<string, boolean>>({})

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs')
      if (!res.ok) throw new Error()
      setJobs(await res.json())
    } catch {
      setNotice('작업 목록을 불러오지 못했습니다')
    }
  }, [])

  useEffect(() => {
    loadJobs()
  }, [loadJobs])

  // 끝나지 않은 작업이 있을 때만 1초마다 조회
  const hasPending = jobs.some((job) => !isDone(job))
  useEffect(() => {
    if (!hasPending) return
    const timer = setInterval(loadJobs, 1000)
    return () => clearInterval(timer)
  }, [hasPending, loadJobs])

  // 끝난 작업을 프론트가 처음 알게 되면 결과가 돌아오는 경로를 연출한다
  useEffect(() => {
    const prev = prevStatus.current
    for (const job of jobs) {
      const before = prev[job.id]
      const isDoneNow = job.status === 'completed' || job.status === 'failed'
      if (before && before !== 'completed' && before !== 'failed' && isDoneNow) {
        run(job.id, ['events', 'master-out', 'db'])
      }
      prev[job.id] = job.status
    }
  }, [jobs, run])

  useEffect(() => {
    if (selectedId === null) return
    fetch(`/api/jobs/${selectedId}`)
      .then((res) => res.json())
      .then((detail) => setEvents(detail.events ?? []))
      .catch(() => setEvents([]))
  }, [selectedId, jobs])

  async function order(type: string) {
    setNotice('')
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, shouldFail }),
      })
      if (!res.ok) {
        setNotice(
          res.status === 502 || res.status === 503
            ? '지금은 작업을 받을 수 없습니다'
            : '작업 요청에 실패했습니다',
        )
        return
      }
      const { jobId } = await res.json()
      // 프론트 → nginx → Master 구간은 순식간이라 화면에서 보이도록 연출한다
      run(jobId, ['front', 'nginx', 'master-in'])
      await loadJobs()
    } catch {
      setNotice('지금은 작업을 받을 수 없습니다')
    }
  }

  async function crash(workerId: string) {
    setNotice('')
    try {
      const res = await fetch(`/api/workers/${workerId}/crash`, { method: 'POST' })
      if (!res.ok) throw new Error()
      const { recoverMs } = await res.json()
      setFallen((prev) => ({ ...prev, [workerId]: true }))
      setTimeout(() => setFallen((prev) => ({ ...prev, [workerId]: false })), recoverMs)
    } catch {
      setNotice('Worker에 장애를 내지 못했습니다')
    }
  }

  return (
    <main>
      <h1>이벤트 드리븐 작업 처리</h1>
      {notice && <p className="notice">{notice}</p>}

      <Pipeline
        jobs={jobs}
        flights={flights}
        fallen={fallen}
        onCrash={crash}
        orderPanel={
          <div className="orders">
            {JOB_TYPES.map(({ type, seconds }) => (
              <button key={type} onClick={() => order(type)}>
                작업 {type} 요청 ({seconds}초)
              </button>
            ))}
            <label>
              <input
                type="checkbox"
                checked={shouldFail}
                onChange={(e) => setShouldFail(e.target.checked)}
              />{' '}
              실패시키기
            </label>
          </div>
        }
      />

      <table>
        <thead>
          <tr>
            <th>번호</th>
            <th>종류</th>
            <th>상태</th>
            <th>Worker</th>
            <th>메시지</th>
            <th>요청 시각</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr
              key={job.id}
              className={job.id === selectedId ? 'selected' : ''}
              onClick={() => setSelectedId(job.id)}
            >
              <td>{job.id}</td>
              <td>{job.type}</td>
              <td className={`status-${job.status}`}>{job.status}</td>
              <td>{workerName(job.workerId) ?? '-'}</td>
              <td>{job.message ?? '-'}</td>
              <td>{timeOf(job.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedId !== null && (
        <section className="log">
          <h2>{selectedId}번 작업 로그</h2>
          <ul>
            {events.map((e, i) => (
              <li key={i}>
                {timeOf(e.createdAt)} {e.event} {workerName(e.workerId) ?? ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
