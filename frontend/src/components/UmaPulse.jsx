export default function UmaPulse() {
  return <span className="uma-pulse" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} style={{ "--ray": index }} />)}</span>;
}
