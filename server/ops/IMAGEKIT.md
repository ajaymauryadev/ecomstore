# ImageKit storage

Set these only in `server/.env` locally or your hosting service's private runtime
environment. Never put the private key in frontend code, a `VITE_*` variable,
a committed example, or a Docker build argument.

```dotenv
IMAGE_STORAGE=imagekit
IMAGEKIT_PRIVATE_KEY=YOUR_REPLACEMENT_PRIVATE_KEY
IMAGEKIT_PUBLIC_KEY=YOUR_PUBLIC_KEY
IMAGEKIT_FOLDER=/smart-kirana/production
```

Use different folders for development and production. The public key is
optional for server-side uploads. The URL endpoint is derived from the upload
response; no frontend configuration is needed. Restart the API after changing
its environment. Local credentials are saved only in the ignored `server/.env`.
Rotate a private key that has been pasted into chat.

From `server`:

```powershell
npm run images:verify
npm run images:migrate
npm run images:status
npm run dev
```

`images:verify` uploads a temporary private WebP, checks its exact bytes through
a signed URL, verifies unsigned access is blocked, and deletes the test file.
`images:migrate` copies existing images to ImageKit, records their mapping in
MongoDB's `mediaassets` collection and verifies each copy's checksum.
It is resumable and retains local originals. Unreferenced or ambiguous legacy
files at the uploads root are skipped rather than published. Changed content
or visibility at a previously migrated path is rejected.
Migration also repairs mappings whose provider file was deleted, using the
unchanged local original. Migrated originals are excluded from automatic orphan
cleanup. Seven tenant images were migrated and verified on 23 November 2026;
two unreferenced legacy PNGs remain local.

Existing `/uploads/TENANT/FILE` links redirect to the public ImageKit CDN URL.
New uploads use stable application paths, so existing clients and database
records need no URL migration. The API validates and re-encodes uploads as WebP
before sending them to ImageKit. It does not write new images to local disk
while `IMAGE_STORAGE=imagekit`.

Payment proofs use `isPrivateFile=true`. The app checks customer/order or staff
permissions before downloading the original bytes using a 60-second signed URL.
Responses remain `private, no-store`; signed URLs and file identifiers are not
returned to clients. Keep named transformations that could expose private
media disabled; ImageKit permits private file access via named transformations.

Failed multipart uploads remove their already-created cloud files. Daily
cleanup removes abandoned images after 24 hours while preserving references
from products, categories, store settings, users, expenses, order snapshots,
packing sessions and payment proofs. Provider errors fail the upload rather
than silently falling back to temporary disk.

Backups download original cloud bytes (`orig-true`) and verify their hashes.
The backup database user needs read access to `mediaassets`, and the backup
process needs `IMAGEKIT_PRIVATE_KEY` in its private environment. The archive
format remains self-contained: restore writes verified local files and does
not depend on the source ImageKit account. To move a restored store to ImageKit,
use a fresh environment folder and run migration against the restored database
and upload directory. Local-file fallback keeps unmigrated images working.
Keep local originals until a database-and-media backup has been verified.

For an existing Oracle deployment, add the runtime variables to
`~/.config/smart-kirana/.env.api`, then run `bash deploy/free/deploy.sh`.
For a new deployment, `configure.sh` prompts for an optional ImageKit private
key and stores it outside the source checkout. The persistent upload volume
continues to support legacy files and verified restores.

[Node SDK](https://github.com/imagekit-developer/imagekit-nodejs) ·
[Private files and signed URLs](https://imagekit.io/docs/media-delivery-basic-security) ·
[Original delivery](https://imagekit.io/docs/core-delivery-features)
