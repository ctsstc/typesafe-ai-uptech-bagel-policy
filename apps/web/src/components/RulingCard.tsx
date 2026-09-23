import { OUTRAGE_LEVELS, type PolicyResult, SECTIONS, VERDICTS } from "@bagel/core";
import { POLICY_URL } from "../lib/links";
import { isFoundingIncident } from "../lib/precedent";

const OUT_OF_SCOPE = {
  other_food: "No bagel detected. This is outside the board's jurisdiction.",
  not_food: "That is not food. The board declines to rule, but has concerns.",
  nonsense: "The board could not make sense of that order.",
} as const;

export function RulingCard({ result, mock }: { result: PolicyResult; mock: boolean }) {
  if (result.kind === "declined") {
    return <article className="card">The board declines to review that.</article>;
  }
  if (result.kind === "out_of_scope") {
    return (
      <article className="card">
        <p className="card-order">“{result.order}”</p>
        <p>{OUT_OF_SCOPE[result.reason]}</p>
      </article>
    );
  }

  const verdict = VERDICTS[result.verdict];
  const outrage = OUTRAGE_LEVELS[Math.round(result.outrage)] ?? OUTRAGE_LEVELS[0];
  return (
    <article className="card" data-verdict={result.verdict}>
      {mock && <p className="mock-note">Simulated ruling. Add a TypeSafe key for real ones.</p>}
      <p className="card-order">“{result.order}”</p>
      <h2 className="verdict">{verdict.label}</h2>
      <p className="verdict-blurb">{verdict.blurb}</p>
      {isFoundingIncident(result) && (
        <p className="precedent">
          <strong>Precedent.</strong> Vanilla cream cheese at a company-wide event is the incident
          that made the <a href={POLICY_URL}>Bagel Policy</a> necessary. The board has seen this
          before.
        </p>
      )}
      {result.sandwich && (
        <p className="sandwich-flag">
          <strong>Sandwich alert.</strong> The policy says a proper bagel is served open-faced.
          Asked to bring bagels and brought sandwiches? You have failed.
        </p>
      )}

      <dl className="sections">
        {result.sections.map((s) => (
          <div key={s.section} className="section-row">
            <dt>{SECTIONS[s.section].title}</dt>
            <dd>
              <span className="tier" data-severity={s.severity ?? "none"}>
                {s.label}
              </span>
              {s.unsure && <span className="unsure"> (the board is split)</span>}
            </dd>
          </div>
        ))}
      </dl>

      {result.sunDried && (
        <p className="concerns">
          <strong>Sun-dried tomatoes.</strong> Not strictly proper, but not a disciplinary matter.
        </p>
      )}

      <p className="outrage">Office reaction: {outrage}.</p>
    </article>
  );
}
