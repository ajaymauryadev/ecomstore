export const UNIT_GROUPS = [
  {
    label: 'Count / Pack',
    units: [
      { value: 'piece', label: 'Piece', short: 'pc' },
      { value: 'sachet', label: 'Sachet', short: 'sachet' },
      { value: 'strip', label: 'Strip', short: 'strip' },
      { value: 'packet', label: 'Packet', short: 'pkt' },
      { value: 'pouch', label: 'Pouch', short: 'pouch' },
      { value: 'stick', label: 'Stick', short: 'stick' },
      { value: 'ladi', label: 'Ladi', short: 'ladi' },
      { value: 'dozen', label: 'Dozen (12)', short: 'dz' },
      { value: 'half_dozen', label: 'Half Dozen (6)', short: '½dz' },
      { value: 'box', label: 'Box', short: 'box' },
      { value: 'carton', label: 'Carton', short: 'ctn' },
      { value: 'bundle', label: 'Bundle', short: 'bndl' },
      { value: 'tray', label: 'Tray', short: 'tray' },
    ],
  },
  {
    label: 'Weight',
    units: [
      { value: 'gram', label: 'Gram', short: 'g' },
      { value: '100g', label: '100 Gram', short: '100g' },
      { value: '250g', label: '250 Gram', short: '250g' },
      { value: '500g', label: '500 Gram', short: '500g' },
      { value: 'kg', label: 'Kilogram', short: 'kg' },
      { value: 'quintal', label: 'Quintal (100kg)', short: 'qtl' },
      { value: 'bora', label: 'Bora (~50kg)', short: 'bora' },
      { value: 'katta', label: 'Katta', short: 'katta' },
      { value: 'sack', label: 'Sack', short: 'sack' },
      { value: 'bag', label: 'Bag', short: 'bag' },
    ],
  },
  {
    label: 'Volume',
    units: [
      { value: 'ml', label: 'Milliliter', short: 'ml' },
      { value: 'liter', label: 'Liter', short: 'L' },
    ],
  },
];

export const ALL_UNITS = UNIT_GROUPS.flatMap((g) => g.units);

export const UNIT_MAP = Object.fromEntries(ALL_UNITS.map((u) => [u.value, u]));

export const getUnitLabel = (value) => UNIT_MAP[value]?.label ?? value;
export const getUnitShort = (value) => UNIT_MAP[value]?.short ?? value;
