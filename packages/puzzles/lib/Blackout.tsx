/** A full blackout for players who can't see anything right now (e.g. "Listen"). */
export function Blackout({ label, detail }: { label: string; detail?: string }) {
  return (
    <div
      role="status"
      style={{
        display: 'grid',
        placeItems: 'center',
        alignContent: 'center',
        gap: 8,
        width: '100%',
        minHeight: 280,
        borderRadius: 12,
        background: '#050608',
        color: '#e8eaee',
        textAlign: 'center',
      }}
    >
      <strong style={{ fontSize: '2rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {label}
      </strong>
      {detail && <span style={{ opacity: 0.6 }}>{detail}</span>}
    </div>
  );
}
