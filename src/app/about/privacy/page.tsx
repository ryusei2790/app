/**
 * @file app/about/privacy/page.tsx
 * @description プライバシー（事前登録と着地ページの計測、mywork#878）。ログイン前でも読める。
 */

export const metadata = { title: "プライバシー — カレンダー家計簿" };

export default function PrivacyPage() {
  return (
    <article className="max-w-none space-y-4 text-sm text-gray-800">
      <h1 className="text-xl font-bold">プライバシー</h1>
      <p className="text-xs text-gray-500">2026年11月1日 制定</p>
      <p>カレンダー家計簿（運営: frural・上田琉聖）が、公開前のお知らせ登録とこのページの閲覧で集める情報と、その使い道です。</p>
      <h2 className="text-base font-bold">集めるもの</h2>
      <ul className="list-disc pl-5">
        <li>事前登録で送られたメールアドレスと、その日時</li>
        <li>どの広告から来たか（URL に付いた utm_source・utm_medium・utm_campaign・utm_content の値）</li>
        <li>このページを開いた数（ブラウザに置くランダムな番号で、同じ人の再訪を数え分けます）と、直前に見ていたサイトのドメイン名</li>
      </ul>
      <p>IP アドレスやブラウザの種類の全文は保存しません。家計簿アプリに入れたお金のデータは、広告やこのページの計測には使いません。</p>
      <h2 className="text-base font-bold">使い道</h2>
      <ul className="list-disc pl-5">
        <li>公開したときのお知らせ1回と、使い方の案内を送るため</li>
        <li>どの広告の説明が分かりやすかったかを比べるため（件数として集計します）</li>
      </ul>
      <p>メールアドレスを第三者に売ったり、広告目的で渡したりしません。</p>
      <h2 className="text-base font-bold">クッキー</h2>
      <p>来た広告（kb_utm）とランダムな番号（kb_vid）をブラウザに30日間保存します。ブラウザの設定で消せます。</p>
      <h2 className="text-base font-bold">保存先</h2>
      <p>Supabase（データベースの所在地: 日本・東京リージョン）に保存し、運営者だけが見られます。</p>
      <h2 className="text-base font-bold">削除・問い合わせ</h2>
      <p>登録の削除や問い合わせは <a href="https://frural.jp/contact" className="text-blue-600 underline">https://frural.jp/contact</a> から、登録したメールアドレスを添えて連絡してください。</p>
    </article>
  );
}
