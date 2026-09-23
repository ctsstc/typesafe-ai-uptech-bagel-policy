import { POLICY_MODEL, QUESTION_SET_VERSION } from "@bagel/core";
import { AUTHOR, CLAUDE_CODE_URL, POLICY_URL, SOURCE_URL, TYPESAFE_URL } from "../lib/links";

export function Footer() {
  return (
    <footer className="footer">
      <p>
        Made by an Uptech employee, not an official Uptech product. The{" "}
        <a href={POLICY_URL}>Bagel Policy</a> is Uptech Studio's. Rulings by Jev from{" "}
        <a href={TYPESAFE_URL}>TypeSafe</a>, which is not affiliated with or endorsing this site.
      </p>
      <p>
        Made by {AUTHOR.name} (
        <a href={AUTHOR.github} rel="noopener" aria-label={`${AUTHOR.name} on GitHub`}>
          GitHub
        </a>
        ,{" "}
        <a href={AUTHOR.linkedin} rel="noopener" aria-label={`${AUTHOR.name} on LinkedIn`}>
          LinkedIn
        </a>
        ). Built with{" "}
        <a href={CLAUDE_CODE_URL} rel="noopener">
          Claude Code
        </a>
        .{" "}
        <a href={SOURCE_URL} rel="noopener">
          Source code on GitHub
        </a>
        .
      </p>
      <p className="footer-meta">
        <span>v{__APP_VERSION__}</span>
        <span>question set {QUESTION_SET_VERSION}</span>
        <span>{POLICY_MODEL}</span>
      </p>
    </footer>
  );
}
