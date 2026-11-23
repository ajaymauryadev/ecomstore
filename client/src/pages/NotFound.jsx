import { useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import Button from '../components/ui/Button';

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-navy-950 flex flex-col items-center justify-center p-4 text-center">
      <div className="w-20 h-20 bg-navy-800 rounded-full flex items-center justify-center mb-6">
        <Compass size={40} className="text-gold-500" />
      </div>
      <h1 className="text-6xl font-black text-gradient mb-2">404</h1>
      <p className="text-xl font-semibold text-slate-200 mb-2">Page not found</p>
      <p className="text-slate-400 text-sm mb-8 max-w-xs">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Button onClick={() => navigate(-1)} variant="secondary" size="lg">
        Go Back
      </Button>
    </div>
  );
}
