import { Link } from "react-router";

export function NotFound() {
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div>
        <p className="text-5xl font-bold text-ember">404</p>
        <p className="font-semibold mt-2">This page wandered off.</p>
        <Link to="/" className="btn-secondary mt-4">
          Back to Discover
        </Link>
      </div>
    </div>
  );
}
