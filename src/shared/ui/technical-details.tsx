/** Technical identities remain available for support, outside the author-facing summary. */
export function TechnicalDetails({
  items,
}: {
  items: Record<string, string | number | undefined>;
}) {
  return (
    <details className="technical-details">
      <summary>技术详情（排查用）</summary>
      <dl>
        {Object.entries(items)
          .filter(([, value]) => value !== undefined)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
    </details>
  );
}
