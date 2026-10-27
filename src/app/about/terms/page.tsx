/**
 * @file app/about/terms/page.tsx
 * @description 利用規約（事前登録の段階のもの、mywork#878）。ログイン前でも読める。
 */

export const metadata = { title: "利用規約 — カレンダー家計簿" };

export default function TermsPage() {
  return (
    <article className="prose prose-sm max-w-none space-y-4 text-gray-800">
      <h1 className="text-xl font-bold">利用規約</h1>
      <p className="text-xs text-gray-500">2026年11月1日 制定</p>
      <p>この規約は、カレンダー家計簿（以下「本サービス」）の公開前のお知らせ登録（以下「事前登録」）について定めます。運営は frural（上田琉聖）です。</p>
      <h2 className="text-base font-bold">1. 事前登録</h2>
      <p>事前登録はメールアドレスを送るだけで、無料です。登録しても本サービスの利用やアカウントの作成が約束されるものではありません。</p>
      <h2 className="text-base font-bold">2. お知らせ</h2>
      <p>本サービスの公開時のお知らせと、使い方の案内をお送りします。不要になったら、問い合わせ窓口に連絡すれば登録を削除します。</p>
      <h2 className="text-base font-bold">3. 禁止すること</h2>
      <p>他人のメールアドレスを無断で登録すること、機械的に大量の登録をすること、本サービスの運営を妨げることを禁止します。</p>
      <h2 className="text-base font-bold">4. 変更・中止</h2>
      <p>本サービスの内容や公開の予定は、予告なく変更・中止することがあります。そのことで生じた損害について、運営は故意または重大な過失がある場合を除き責任を負いません。</p>
      <h2 className="text-base font-bold">5. 個人情報</h2>
      <p>取り扱いは<a href="/about/privacy" className="text-blue-600 underline">プライバシー</a>のとおりです。</p>
      <h2 className="text-base font-bold">6. 問い合わせ</h2>
      <p><a href="https://frural.jp/contact" className="text-blue-600 underline">https://frural.jp/contact</a></p>
    </article>
  );
}
