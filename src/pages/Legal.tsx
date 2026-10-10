import LegalText from '../components/LegalText';

export default function Legal({ privacy = false }: { privacy?: boolean }) {
  return <main className="p-6 space-y-6">
    <a href="/login" className="underline">Voltar ao Aquecimento</a>
    <h1 className="text-2xl font-bold">{privacy ? 'Política de Privacidade' : 'Termos de Utilização'}</h1>
    <LegalText privacy={privacy} />
    <a href={privacy ? '/termos' : '/privacidade'} className="block underline">{privacy ? 'Termos de Utilização' : 'Política de Privacidade'}</a>
  </main>;
}
