import { useClientPagination } from '../../hooks/usePagination';
import Pagination from '../../components/ui/Pagination';
import { useRef, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  User, Phone, MapPin, Heart, ShoppingBag, LogOut, Plus, Trash2,
  Edit2, ChevronRight,
} from 'lucide-react';
import { useSelector } from 'react-redux';
import { selectCurrentUser } from '../../features/auth/authSlice';
import { useLogoutMutation } from '../../features/auth/authApi';
import {
  useGetCustomerProfileQuery,
  useUpdateCustomerProfileMutation,
  useSaveAddressMutation,
  useDeleteAddressMutation,
  useGetFavoritesQuery,
} from '../../features/customer/customerApi';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import { formatCurrency } from '../../utils/formatters';
import { cn } from '../../utils/cn';
import toast from 'react-hot-toast';

const API_BASE = import.meta.env.VITE_API_URL?.replace('/api/v1', '') || '';
function imgSrc(url) { return url?.startsWith('/') ? `${API_BASE}${url}` : url; }

const ADDR_EMPTY = { label: 'Home', line1: '', landmark: '', city: '', state: '', pincode: '', isDefault: false };

export default function AccountPage() {
  const { storeSlug } = useParams();
  const navigate = useNavigate();
  const user = useSelector(selectCurrentUser);
  const [logout, { isLoading: isLoggingOut }] = useLogoutMutation();

  const skipAccountQueries = user?.role !== 'customer';
  const { data: profileData } = useGetCustomerProfileQuery(storeSlug, { skip: skipAccountQueries });
  const { data: favData } = useGetFavoritesQuery(storeSlug, { skip: skipAccountQueries });
  const [updateProfile, { isLoading: isUpdating }] = useUpdateCustomerProfileMutation();
  const [saveAddress, { isLoading: isSavingAddr }] = useSaveAddressMutation();
  const [deleteAddress, { isLoading: isDeletingAddr }] = useDeleteAddressMutation();

  const profile = profileData?.data?.user;
  const favorites = favData?.data?.products || [];
  const favoritesPaging = useClientPagination(favorites, storeSlug, 'cards');
  const addressPaging = useClientPagination(profile?.savedAddresses || [], storeSlug);

  const [editProfile, setEditProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: '', email: '' });
  const profileNameInput = useRef(null);
  const addressLineInput = useRef(null);
  const [addrModal, setAddrModal] = useState(false);
  const [addrForm, setAddrForm] = useState(ADDR_EMPTY);
  const [deleteAddrTarget, setDeleteAddrTarget] = useState(null);

  const handleEditProfile = () => {
    setProfileForm({ name: profile?.name || '', email: profile?.email || '' });
    setEditProfile(true);
  };

  const handleSaveProfile = async () => {
    try {
      await updateProfile({ slug: storeSlug, ...profileForm }).unwrap();
      toast.success('Profile updated!');
      setEditProfile(false);
    } catch (err) {
      toast.error(err?.data?.message || 'Update failed');
    }
  };

  const handleSaveAddress = async () => {
    if (!addrForm.line1.trim() || !addrForm.city.trim()) return toast.error('Address and city are required');
    try {
      await saveAddress({ slug: storeSlug, ...addrForm }).unwrap();
      toast.success('Address saved!');
      setAddrModal(false);
      setAddrForm(ADDR_EMPTY);
    } catch (err) {
      toast.error(err?.data?.message || 'Save failed');
    }
  };

  const handleDeleteAddress = async (addressId) => {
    try {
      await deleteAddress({ slug: storeSlug, addressId }).unwrap();
      toast.success('Address removed.');
      setDeleteAddrTarget(null);
    } catch (err) {
      toast.error(err?.data?.message || 'Delete failed');
    }
  };

  const handleLogout = async () => {
    try {
      await logout({ requireServerConfirmation: true }).unwrap();
      toast.success('Logged out');
      navigate(`/s/${storeSlug}`);
    } catch (error) {
      toast.error(error?.data?.message || 'Could not sign out. Try again.');
    }
  };

  if (!user || user.role !== 'customer') {
    return (
      <div className="text-center py-16 text-slate-500">
        <User size={48} strokeWidth={1} className="mx-auto mb-3" />
        <p className="font-medium text-slate-400">Not logged in</p>
        <Link to={`/s/${storeSlug}/auth`} className="btn btn-primary btn-sm mt-4 inline-block">Login / Register</Link>
      </div>
    );
  }

  return (
    <div className="customer-account max-w-4xl mx-auto space-y-5 pb-8">
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-100">My Account</h1>
      {/* Profile card */}
      <div className="card account-profile">
        <div className="flex items-center gap-4">
          <div className="account-avatar w-14 h-14 bg-gradient-to-br from-gold-500/30 to-gold-600/10 border border-gold-500/20 rounded-2xl flex items-center justify-center">
            <span className="text-2xl font-black text-gold-400">{profile?.name?.[0]?.toUpperCase()}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-100 text-lg">{profile?.name}</p>
            <p className="text-sm text-slate-400 flex items-center gap-1.5 mt-0.5">
              <Phone size={12} /> {profile?.phone}
            </p>
            {profile?.email && <p className="text-xs text-slate-500">{profile.email}</p>}
          </div>
          <button type="button" aria-label="Edit profile" onClick={handleEditProfile} className="workspace-row-action shrink-0 rounded-xl hover:bg-navy-700 text-slate-400 hover:text-gold-400 transition-colors">
            <Edit2 size={16} />
          </button>
        </div>
      </div>

      {/* Quick actions */}
      <div className="account-shortcuts grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Link
          to={`/s/${storeSlug}/orders`}
          className="card hover:border-navy-600 transition-all flex items-center gap-3"
        >
          <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center">
            <ShoppingBag size={18} className="text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-200">My Orders</p>
            <p className="text-xs text-slate-400">Track & history</p>
          </div>
          <ChevronRight size={14} className="ml-auto text-slate-600" />
        </Link>
        <button
          onClick={() => document.getElementById('favorites-section')?.scrollIntoView({ behavior: 'smooth' })}
          className="card hover:border-navy-600 transition-all flex items-center gap-3 text-left"
        >
          <div className="w-10 h-10 bg-red-500/10 rounded-xl flex items-center justify-center">
            <Heart size={18} className="text-red-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-200">Favourites</p>
            <p className="text-xs text-slate-400">{favorites.length} saved</p>
          </div>
          <ChevronRight size={14} className="ml-auto text-slate-600" />
        </button>
      </div>

      {/* Saved Addresses */}
      <div className="card account-addresses space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <MapPin size={14} className="text-gold-400" /> Saved Addresses
          </p>
          <button
            onClick={() => { setAddrForm(ADDR_EMPTY); setAddrModal(true); }}
            className="btn btn-secondary btn-sm gap-1"
          >
            <Plus size={12} /> Add
          </button>
        </div>

        {!profile?.savedAddresses?.length ? (
          <div className="text-center py-6 text-slate-500">
            <MapPin size={28} strokeWidth={1} className="mx-auto mb-2" />
            <p className="text-sm">No saved addresses</p>
          </div>
        ) : (
          <div className="space-y-2">
            {addressPaging.items.map((addr) => (
              <div key={addr._id} className="account-address flex items-start justify-between gap-3 bg-navy-800/60 rounded-xl p-3 border border-navy-700/40">
                <div className="flex items-start gap-2.5 min-w-0">
                  <MapPin size={13} className="text-gold-400 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-slate-300">{addr.label}</p>
                      {addr.isDefault && (
                        <span className="bg-gold-500/10 text-gold-400 text-[9px] font-bold px-1.5 py-0.5 rounded border border-gold-500/20">DEFAULT</span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{addr.line1}</p>
                    {addr.city && <p className="text-xs text-slate-500">{[addr.city, addr.state, addr.pincode].filter(Boolean).join(', ')}</p>}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`Delete ${addr.label || 'saved'} address`}
                  onClick={() => setDeleteAddrTarget(addr._id)}
                  className="workspace-row-action hover:bg-red-500/10 text-slate-500 hover:text-red-400 transition-colors shrink-0"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Pagination meta={addressPaging.meta} page={addressPaging.page} onPageChange={addressPaging.setPage} label="saved addresses" hideOnSinglePage />

      {/* Favourites */}
      {favorites.length > 0 && (
        <div id="favorites-section" className="card space-y-3">
          <p className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Heart size={14} className="text-red-400" /> Favourites
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {favoritesPaging.items.map((product) => {
              const variant = product.variants?.filter((v) => v.isActive)?.[0];
              if (!variant) return null;
              const price = variant.offerPrice ?? variant.retailPrice;
              return (
                <Link
                  key={product._id}
                  to={`/s/${storeSlug}/p/${product._id}`}
                  className="bg-navy-800 rounded-xl border border-navy-700/60 overflow-hidden hover:border-navy-600 transition-all"
                >
                  <div className="aspect-square bg-navy-750">
                    {product.mainImage ? (
                      <img src={imgSrc(product.mainImage)} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-navy-700">
                        <Heart size={20} className="text-navy-500" />
                      </div>
                    )}
                  </div>
                  <div className="p-2">
                    <p className="text-xs text-slate-200 line-clamp-1">{product.name}</p>
                    <p className="text-xs font-bold text-gold-400 mt-0.5">{formatCurrency(price)}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <Pagination meta={favoritesPaging.meta} page={favoritesPaging.page} onPageChange={favoritesPaging.setPage} label="favorites" hideOnSinglePage />

      {/* Logout */}
      <button
        onClick={handleLogout}
        disabled={isLoggingOut}
        className="account-logout w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-red-500/20 text-red-400 hover:bg-red-500/10 text-sm font-medium transition-colors"
      >
        <LogOut size={16} /> {isLoggingOut ? 'Logging out…' : 'Logout'}
      </button>

      {/* Edit Profile Modal */}
      <Modal isOpen={editProfile} onClose={() => setEditProfile(false)} title="Edit Profile" initialFocusRef={profileNameInput} size="sm">
        <div className="space-y-4">
          <Input ref={profileNameInput} label="Full Name" value={profileForm.name} onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })} />
          <Input label="Email (optional)" type="email" value={profileForm.email} onChange={(e) => setProfileForm({ ...profileForm, email: e.target.value })} />
          <div className="flex gap-3 pt-1">
            <Button variant="secondary" fullWidth onClick={() => setEditProfile(false)}>Cancel</Button>
            <Button fullWidth isLoading={isUpdating} onClick={handleSaveProfile}>Save</Button>
          </div>
        </div>
      </Modal>

      {/* Add Address Modal */}
      <Modal isOpen={addrModal} onClose={() => setAddrModal(false)} title="Add Address" initialFocusRef={addressLineInput} size="sm">
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-slate-300 block mb-2">Label</label>
            <div className="flex gap-2">
              {['Home', 'Work', 'Other'].map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setAddrForm({ ...addrForm, label: l })}
                  className={cn('px-3 py-1.5 rounded-lg border text-xs font-medium transition-all',
                    addrForm.label === l ? 'bg-gold-500/10 border-gold-500/40 text-gold-400' : 'bg-navy-800 border-navy-700 text-slate-400'
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <Input ref={addressLineInput} label="Address Line 1 *" value={addrForm.line1} onChange={(e) => setAddrForm({ ...addrForm, line1: e.target.value })} placeholder="House, street, area" />
          <Input label="Landmark" value={addrForm.landmark} onChange={(e) => setAddrForm({ ...addrForm, landmark: e.target.value })} placeholder="Near ..." />
          <div className="grid grid-cols-3 gap-2">
            <Input label="City *" value={addrForm.city} onChange={(e) => setAddrForm({ ...addrForm, city: e.target.value })} />
            <Input label="State" value={addrForm.state} onChange={(e) => setAddrForm({ ...addrForm, state: e.target.value })} />
            <Input label="Pincode" value={addrForm.pincode} onChange={(e) => setAddrForm({ ...addrForm, pincode: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={addrForm.isDefault}
              onChange={(e) => setAddrForm({ ...addrForm, isDefault: e.target.checked })}
              className="w-4 h-4 rounded border-navy-600 bg-navy-800 text-gold-500"
            />
            <span className="text-xs text-slate-300">Set as default address</span>
          </label>
          <div className="flex gap-3 pt-1">
            <Button variant="secondary" fullWidth onClick={() => setAddrModal(false)}>Cancel</Button>
            <Button fullWidth isLoading={isSavingAddr} onClick={handleSaveAddress}>Save Address</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={Boolean(deleteAddrTarget)} onClose={() => setDeleteAddrTarget(null)} title="Remove address?" size="sm">
          <div className="space-y-4">
            <p className="text-sm font-semibold text-slate-100">Remove this address?</p>
            <div className="flex gap-3">
              <Button variant="secondary" fullWidth onClick={() => setDeleteAddrTarget(null)}>Cancel</Button>
              <Button variant="danger" fullWidth isLoading={isDeletingAddr} onClick={() => handleDeleteAddress(deleteAddrTarget)}>Remove</Button>
            </div>
          </div>
      </Modal>
    </div>
  );
}
