export default function LoadError({ title, error, retry }) {
  return (
    <div className="workspace-feedback flex flex-wrap items-center justify-between gap-3" role="alert">
      <div>
        <p className="font-semibold">{title}</p>
        {error?.data?.message && <p className="mt-1 text-sm">{error.data.message}</p>}
      </div>
      <button type="button" className="btn-secondary" onClick={retry}>Try again</button>
    </div>
  );
}
