import { LEGAL_DATE, TERMS_VERSION, privacySections, termsSections } from '../lib/legal';

export default function LegalText({ privacy = false }: { privacy?: boolean }) {
  return <div className="space-y-4 text-sm text-slate-300">
    <p>Versão {TERMS_VERSION} — {LEGAL_DATE}</p>
    {(privacy ? privacySections : termsSections).map(section => <section key={section.title} className="space-y-1">
      <h2 className="font-semibold text-white">{section.title}</h2>
      <p>{section.text}</p>
    </section>)}
  </div>;
}
