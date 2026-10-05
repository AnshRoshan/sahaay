import ActionButton from "@/components/ActionButton";
import UploadForm from "@/components/UploadForm";
import { Card, PageHeader, Stat, Td, Th, fmtTs } from "@/components/ui";
import { getDataSummary } from "@/lib/server/data";

export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const d = await getDataSummary();
  return (
    <div className="space-y-6">
      <PageHeader title="Import & data quality" subtitle="Upload your CSV exports. Sahaay detects columns, validates every row, and reports problems instead of silently assuming. Each upload of a file type replaces the previous one." />
      <Card>
        <UploadForm />
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 text-sm">
          <span className="text-slate-600">No data handy?</span>
          <ActionButton endpoint="/api/demo/load" variant="secondary" done="demo">Load demo garment shop</ActionButton>
          <span className="text-slate-400">or download samples:</span>
          {["products", "inventory", "suppliers", "sales"].map((k) => <a key={k} href={`/api/samples/${k}.csv`} className="text-indigo-700 underline">{k}.csv</a>)}
        </div>
      </Card>

      {d.hasData && (
        <Card id="quality">
          <h2 className="font-semibold text-slate-900">Data understanding</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Stat label="Sales records" value={d.salesRecords.toLocaleString()} />
            <Stat label="Products" value={d.products} />
            <Stat label="Suppliers" value={d.suppliers} />
            <Stat label="Latest sale" value={d.asOf} />
          </div>
          <ul className="mt-4 space-y-1.5 text-sm">
            <li className="text-emerald-700">✓ {d.salesRecords.toLocaleString()} sales records · {d.products} products · {d.suppliers} suppliers</li>
            {d.issues.map((i) => (
              <li key={i.id} className={i.severity === "error" ? "text-red-700" : i.severity === "warning" ? "text-amber-800" : "text-slate-600"}>
                {i.severity === "info" ? "ℹ" : "⚠"} {i.message}
                {Array.isArray(i.sample) && i.sample.length > 0 && <span className="ml-1 font-mono text-xs text-slate-400">e.g. {i.sample.slice(0, 3).map((x) => JSON.stringify(x)).join(", ").slice(0, 120)}</span>}
              </li>
            ))}
            {d.issues.length === 0 && <li className="text-emerald-700">✓ No data-quality issues found.</li>}
          </ul>
        </Card>
      )}

      <Card>
        <h2 className="font-semibold text-slate-900">Expected files</h2>
        <div className="mt-3 overflow-x-auto"><table className="w-full">
          <thead><tr><Th>File</Th><Th>Required columns</Th><Th>Optional</Th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            <tr><Td className="font-mono">sales.csv</Td><Td>date, product_id, quantity</Td><Td>price, transaction_id</Td></tr>
            <tr><Td className="font-mono">inventory.csv</Td><Td>product_id, current_stock</Td><Td>reorder_level</Td></tr>
            <tr><Td className="font-mono">products.csv</Td><Td>product_id</Td><Td>name, category, unit_cost, selling_price</Td></tr>
            <tr><Td className="font-mono">suppliers.csv</Td><Td>supplier_id, product_id</Td><Td>price, lead_time_days, minimum_order_quantity, supplier_name</Td></tr>
          </tbody></table></div>
        <p className="mt-3 text-xs text-slate-500">Dates: YYYY-MM-DD or day-first DD/MM/YYYY. Common aliases (sku, qty, units, stock…) are recognised. Unreadable dates are rejected and listed, never guessed.</p>
      </Card>

      {d.imports.length > 0 && (
        <Card>
          <h2 className="font-semibold text-slate-900">Import history</h2>
          <table className="mt-2 w-full"><thead><tr><Th>When</Th><Th>File</Th><Th>Type</Th><Th>Rows</Th><Th>Imported</Th><Th>Rejected</Th></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.imports.map((i) => <tr key={i.id}><Td>{fmtTs(i.createdAt)}</Td><Td>{i.filename}</Td><Td>{i.kind}</Td><Td>{i.rowsTotal}</Td><Td>{i.rowsOk}</Td><Td>{i.rowsRejected}</Td></tr>)}</tbody></table>
        </Card>
      )}
    </div>
  );
}
