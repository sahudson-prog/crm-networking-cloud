import Link from "next/link";
import type { ReactNode } from "react";
import type { LegalDocument } from "../content/legalDocuments";
import { parseLegalDocument, type LegalBlock } from "../lib/legalDocumentRenderer";
import { PublicSiteLinks } from "./PublicSiteLinks";

export function LegalDocumentPage({ document }: { document: LegalDocument }) {
  const blocks = parseLegalDocument(document.content);

  return (
    <main className="public-legal-page">
      <div aria-hidden="true" className="onboarding-intro-background" />
      <section className="public-legal-panel">
        <article className="public-legal-document">
          {blocks.map((block, index) => renderBlock(block, index))}
        </article>

        <footer className="public-legal-footer">
          <PublicSiteLinks />
          <Link href="/">Volver a Coffeecito</Link>
        </footer>
      </section>
    </main>
  );
}

function renderBlock(block: LegalBlock, index: number) {
  if (block.type === "heading") {
    if (block.level === 1) return <h1 key={index}>{renderInline(block.content)}</h1>;
    if (block.level === 2) return <h2 key={index}>{renderInline(block.content)}</h2>;
    return <h3 key={index}>{renderInline(block.content)}</h3>;
  }
  if (block.type === "list") {
    return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item)}</li>)}</ul>;
  }
  return <p key={index}>{renderInline(block.content)}</p>;
}

function renderInline(content: string): ReactNode[] {
  const matches = content.split(/(\*\*[^*]+\*\*|\`[^\`]+\`)/g);
  return matches.filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <span key={index}>{part.slice(2, -2)}</span>;
    if (part.startsWith("\`") && part.endsWith("\`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}
