import { useRef } from 'react';
import { Camera, X, Star, Loader2, Image as ImageIcon } from 'lucide-react';
import { cn } from '../../utils/cn';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';

function ImageSlot({ image, isMain, onRemove, onSetMain, isPlaceholder, onUpload, isUploading, disabled }) {
  const inputRef = useRef(null);

  if (isPlaceholder) {
    return (
      <>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={isUploading}
          className={cn(
            'relative aspect-square rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-2',
            'border-navy-600 bg-navy-800/40 hover:border-gold-500/50 hover:bg-navy-700/40 transition-all duration-200',
            isUploading && 'opacity-50 cursor-not-allowed'
          )}
        >
          {isUploading ? (
            <Loader2 size={20} className="text-gold-400 animate-spin" />
          ) : (
            <>
              <Camera size={20} className="text-slate-500" />
              <span className="text-[11px] text-slate-500 text-center leading-tight">Add Photo</span>
            </>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onUpload(file);
          }}
        />
      </>
    );
  }

  const src = image.url?.startsWith('/') ? `${API_BASE}${image.url}` : image.url;

  return (
    <div className={cn(
      'relative aspect-square rounded-2xl overflow-hidden group border-2 transition-all duration-200',
      isMain ? 'border-gold-500 shadow-glow-sm' : 'border-navy-700/60 hover:border-navy-600'
    )}>
      <img src={src} alt="" className="w-full h-full object-cover" />

      <div className="absolute inset-0 bg-black/50 opacity-100 sm:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center justify-center gap-1.5">
        {!isMain && (
          <button
            type="button"
            onClick={onSetMain}
            disabled={disabled}
            title="Set as main image"
            className="p-1.5 rounded-lg bg-gold-500/90 text-navy-950 hover:bg-gold-400 transition-colors"
          >
            <Star size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove image"
          disabled={disabled}
          className="p-1.5 rounded-lg bg-red-500/90 text-white hover:bg-red-500 transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {isMain && (
        <div className="absolute top-1.5 left-1.5 bg-gold-500 text-navy-950 text-[9px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
          <Star size={8} fill="currentColor" /> Main
        </div>
      )}
    </div>
  );
}

export default function ImageUploader({ images = [], onChange, uploadImage, uploading }) {
  const MAX = 5;

  const handleUpload = async (file) => {
    if (images.length >= MAX) {
      toast.error(`Maximum ${MAX} images allowed.`);
      return;
    }
    try {
      const formData = new FormData();
      formData.append('image', file);
      const result = await uploadImage(formData).unwrap();
      const url = result?.data?.url;
      if (!url) throw new Error('Upload failed');
      onChange([...images, { url, isMain: images.length === 0 }]);
    } catch (err) {
      toast.error(err?.data?.message || 'Image upload failed. Please try again.');
    }
  };

  const remove = (idx) => {
    const next = images.filter((_, i) => i !== idx);
    if (next.length > 0 && !next.some((i) => i.isMain)) next[0] = { ...next[0], isMain: true };
    onChange(next);
  };

  const setMain = (idx) => {
    onChange(images.map((img, i) => ({ ...img, isMain: i === idx })));
  };

  const slots = Array.from({ length: MAX });

  return (
    <div>
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
        {slots.map((_, idx) => {
          const img = images[idx];
          return img ? (
            <ImageSlot
              key={img.url}
              image={img}
              isMain={img.isMain}
              disabled={uploading}
              onRemove={() => remove(idx)}
              onSetMain={() => setMain(idx)}
            />
          ) : idx === images.length && (
            <ImageSlot
              key={`slot-${idx}`}
              isPlaceholder
              onUpload={handleUpload}
              isUploading={uploading}
            />
          );
        })}
      </div>
      <p className="text-xs text-slate-500 mt-2 flex items-center gap-1.5">
        <ImageIcon size={12} />
        Up to 5 images. JPEG, PNG, WebP · Max 5MB each. Click <Star size={10} /> to set main image.
      </p>
    </div>
  );
}
