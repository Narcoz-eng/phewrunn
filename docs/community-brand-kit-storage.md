## Community Brand-Kit Storage

Use object storage only for community identity assets:
- `logo`
- `banner`
- `mascot`
- `1-5` reference memes

Do not store generated raid memes. The app already renders those client-side, downloads/copies them locally, and opens X without persisting the generated image.

### Recommended setup

Use `Cloudflare R2` or another S3-compatible bucket.

Why:
- cheap for a very small asset footprint
- no Postgres bloat
- stable image delivery for room headers and meme rendering
- keeps the persistence surface limited to community brand-kit assets

### Required backend env vars

```env
COMMUNITY_ASSET_STORAGE_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
COMMUNITY_ASSET_STORAGE_REGION=auto
COMMUNITY_ASSET_STORAGE_BUCKET=phewrunn-community-assets
COMMUNITY_ASSET_ACCESS_KEY_ID=<r2-access-key-id>
COMMUNITY_ASSET_SECRET_ACCESS_KEY=<r2-secret-access-key>
COMMUNITY_ASSET_PUBLIC_BASE_URL=https://<public-bucket-domain-or-custom-cdn>/phewrunn-community-assets
COMMUNITY_ASSET_UPLOAD_EXPIRES_SECONDS=600
```

### Retention policy

Keep only the room brand kit.

Recommended rules:
- delete replaced/orphaned assets immediately
- cap uploads to a small size budget
- convert oversized source images to compressed formats before upload when practical
- keep generated raid outputs ephemeral and client-side only

### Product rule

Persistent storage is for room identity, not raid output.

That means:
- room header stays branded and stable
- meme generation has real community references
- storage cost stays low
- users do not accumulate large generated image archives on the backend
