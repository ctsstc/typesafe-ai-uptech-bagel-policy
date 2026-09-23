export function AnotherButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="button button-secondary" onClick={onClick}>
      Review another order
    </button>
  );
}
