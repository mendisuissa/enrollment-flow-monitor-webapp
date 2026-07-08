import { useEffect, useState } from 'react';

export default function SupervisorWidget() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch('/api/supervisor/status', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setData(d); })
      .catch(() => {});
  }, []);

  if (!data) return null;

  const { summary = {}, lastCheck, running } = data;
  const stuckCount = summary.stuckMissions ?? 0;
  const criticals  = summary.openCriticals ?? 0;
  const escalated  = summary.lastEscalated ?? false;

  const color = !data.ok ? '#EF4444'
    : stuckCount > 0 || criticals > 0 ? '#F59E0B'
    : escalated ? '#F59E0B'
    : '#10B981';

  const label = !data.ok ? 'Supervisor offline'
    : stuckCount > 0 ? `${stuckCount} mission${stuckCount > 1 ? 's' : ''} stuck`
    : criticals > 0 ? `${criticals} critical open`
    : escalated ? 'Escalated — check bot'
    : running ? 'Supervisor running…'
    : 'Supervisor — all clear';

  const ago = lastCheck ? (() => {
    const m = Math.round((Date.now() - new Date(lastCheck).getTime()) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
  })() : null;

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 7,
      padding: '4px 12px', borderRadius: 99,
      background: `${color}12`, border: `1px solid ${color}30`,
      fontSize: 11, fontWeight: 600, color,
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
      🤖 {label}
      {ago && <span style={{ fontWeight: 400, opacity: 0.6, marginLeft: 2 }}>{ago}</span>}
    </div>
  );
}
