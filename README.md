# Kerfspan v0.1.0 — self-hosting source kit

Kerfspan turns line art and photographs into connected geometry for CNC plasma
cutting. This ZIP contains the source, Docker Compose setup, and a bundled local
image-segmentation model. It builds two images: a Node web app and an unexposed
Python analysis service. This kit is for a **fresh installation**; it does not
automatically migrate an existing `kerfloom` or `stencil-cnc` deployment.

The release tree uses synthetic vector artwork in the sign-in preview and
contains no portrait screenshots, sample photographs, projects, invitations,
credentials, or database. See [NOTICE.md](NOTICE.md) for the model's official
source, checksum, and Apache 2.0 terms. Kerfspan's own code and documentation
are GPL-3.0-or-later; see [LICENSE](LICENSE).

## Install on this computer

Requires Docker with Compose, `openssl`, `curl`, Python 3, and approximately
3 GB of free disk for the built images. The default web port binds only to
`127.0.0.1:3000`; the analysis service has no host port.

1. Verify the downloaded ZIP with the separately downloaded `SHA256SUMS`, then
   extract it. Run these commands in the extracted `Kerfspan-v0.1.0/` folder.
2. Copy `site.env.example` to `site.env`. Generate **two independent** values
   with `openssl rand -hex 32`, put one in `ADMIN_TOKEN` and the other in
   `PROJECT_ENCRYPTION_KEY`, and run `chmod 600 site.env`. Keep this file private.
3. Run `docker compose config --quiet` and `docker compose up -d --build`.
   A first build downloads pinned Node/Python dependencies and can take time.
4. Check `curl --fail http://127.0.0.1:3000/api/health`, then run
   `./admin.sh invite "Local browser"`. Open <http://localhost:3000/> and
   redeem the returned one-time code.

Use `docker compose ps` and `docker compose logs` if either service is not
healthy. The [user handbook](docs/KERFSPAN_USER_GUIDE.md) explains the editor.
For a first experiment, upload `examples/synthetic-panel.png`, a generated
geometric fixture with no person or private data. Its generator is alongside
it. Use synthetic artwork when sharing a screenshot or bug report.

## Access, data, and updates

For access from another device, terminate HTTPS at a private reverse proxy or
VPN and set `PUBLIC_BASE_URL` to that origin. Keep the web container's port
private and never expose the admin API directly. Browser credentials and
offline storage are tied to the origin. `TRUST_PROXY_HEADERS=true` is only
appropriate behind a trusted proxy that clients cannot bypass.

Compose uses the project name `kerfspan` and a `kerfspan-data` volume. Back up
that **entire volume together with `site.env`**; without the active encryption
key, stored projects cannot be restored. `docker compose down` keeps the
volume. `docker compose down -v` deletes it. Before an upgrade, confirm edits
are saved to the server, take a backup, and retain `site.env`. This package is
not an in-place upgrade kit for installations using older volume names.

Kerfspan helps prepare geometry; it does not certify a physical cut. Verify
material, dimensions, kerf compensation, supports, cut order, fixturing, and
machine settings in CAM before manufacturing. The model's segmentation can be
imperfect, especially with poor lighting or occlusion.

On one x86-64 test host with an Intel Celeron 2957U and no AES CPU feature,
the MediaPipe 1.0.1 wheel exited with an illegal instruction when loading the
model. The line-art workflow passed there; model loading passed in the built
ARM64 analysis image. Check CPU compatibility before relying on photograph
segmentation on older x86-64 hardware.

## Source and support

This tagged tree is the complete source used to build the two containers.
The main [Kerfspan repository](https://github.com/zandaulion/kerfspan) has the
development tests and detailed deployment/history documents. Report bugs with
synthetic fixtures, never private photographs or project records. For a private
security report, follow [SECURITY.md](SECURITY.md).
