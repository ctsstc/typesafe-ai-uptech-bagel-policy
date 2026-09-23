export function PendingCard({ order, message }: { order: string; message?: string }) {
  return (
    <article className="card card-pending">
      {/* The live region reads the ruling's own echo later, and never a declined order's text. */}
      <p className="card-order" aria-hidden="true">
        “{order}”
      </p>
      <p className="pending">{message ?? "The board is deliberating…"}</p>
      <div className="skeleton" aria-hidden="true">
        <span className="skeleton-verdict" />
        <span className="skeleton-row" />
        <span className="skeleton-row" />
        <span className="skeleton-row" />
      </div>
    </article>
  );
}
