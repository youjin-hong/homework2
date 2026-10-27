import { useCallback, useEffect, useState } from 'react'
import Kitchen from './Kitchen'
import { chefName } from './names'
import type { Job } from './types'

type JobEvent = {
  event: string
  workerId: string | null
  message: string | null
  createdAt: string
}

const MENUS = ['라면', '돈까스', '김치볶음밥']
const isDone = (job: Job) => job.status === 'completed' || job.status === 'failed'
const timeOf = (createdAt: string) => createdAt.slice(11, 19)

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [shouldFail, setShouldFail] = useState(false)
  const [notice, setNotice] = useState('')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [events, setEvents] = useState<JobEvent[]>([])
  const [receivingId, setReceivingId] = useState<number | null>(null)
  const [fallen, setFallen] = useState<Record<string, boolean>>({})

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs')
      if (!res.ok) throw new Error()
      setJobs(await res.json())
    } catch {
      setNotice('주문 목록을 불러오지 못했습니다')
    }
  }, [])

  useEffect(() => {
    loadJobs()
  }, [loadJobs])

  // 끝나지 않은 주문이 있을 때만 1초마다 조회
  const hasPending = jobs.some((job) => !isDone(job))
  useEffect(() => {
    if (!hasPending) return
    const timer = setInterval(loadJobs, 1000)
    return () => clearInterval(timer)
  }, [hasPending, loadJobs])

  useEffect(() => {
    if (selectedId === null) return
    fetch(`/api/jobs/${selectedId}`)
      .then((res) => res.json())
      .then((detail) => setEvents(detail.events ?? []))
      .catch(() => setEvents([]))
  }, [selectedId, jobs])

  async function order(menu: string) {
    setNotice('')
    try {
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menu, shouldFail }),
      })
      if (!res.ok) {
        setNotice(
          res.status === 502 || res.status === 503
            ? '지금은 주문을 받을 수 없습니다'
            : '주문에 실패했습니다',
        )
        return
      }
      const { jobId } = await res.json()
      setReceivingId(jobId)
      await loadJobs()
      // 홀 매니저가 접수하는 장면을 잠깐 보여 준 뒤 꽂이로 보낸다
      setTimeout(() => setReceivingId((current) => (current === jobId ? null : current)), 2500)
    } catch {
      setNotice('지금은 주문을 받을 수 없습니다')
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
      setNotice('요리사를 쓰러뜨리지 못했습니다')
    }
  }

  return (
    <main>
      <h1>강식당 주문 현황</h1>

      {notice && <p className="notice">{notice}</p>}

      <Kitchen
        jobs={jobs}
        receivingId={receivingId}
        fallen={fallen}
        onCrash={crash}
        orderPanel={
          <div className="orders">
            {MENUS.map((menu) => (
              <button key={menu} onClick={() => order(menu)}>
                {menu} 주문
              </button>
            ))}
            <label>
              <input
                type="checkbox"
                checked={shouldFail}
                onChange={(e) => setShouldFail(e.target.checked)}
              />{' '}
              재료 소진(실패시키기)
            </label>
          </div>
        }
      />

      <table>
        <thead>
          <tr>
            <th>주문번호</th>
            <th>메뉴</th>
            <th>상태</th>
            <th>요리사</th>
            <th>메시지</th>
            <th>주문 시각</th>
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
              <td>{job.menu}</td>
              <td className={`status-${job.status}`}>{job.status}</td>
              <td>{chefName(job.workerId) ?? '-'}</td>
              <td>{job.message ?? '-'}</td>
              <td>{timeOf(job.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedId !== null && (
        <section className="log">
          <h2>{selectedId}번 주문 로그</h2>
          <ul>
            {events.map((e, i) => (
              <li key={i}>
                {timeOf(e.createdAt)} {e.event} {chefName(e.workerId) ?? ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
