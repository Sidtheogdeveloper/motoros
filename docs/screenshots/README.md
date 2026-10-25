# Screenshot notes

Captured 25 October 2026 (Asia/Calcutta), from the locally running application after
branding commit `336f933`. Files are actual browser screenshots, losslessly compressed
as PNG. The app and authenticated records were not mocked or visually retouched.

| File                | Screen                                                | Viewport    |
| ------------------- | ----------------------------------------------------- | ----------- |
| landing.png         | Anonymous `/`                                         | 1440 × 1000 |
| dashboard.png       | Signed-in `/`, synthetic Apex workshop                | 1440 × 1000 |
| vehicle-history.png | Existing fixture vehicle detail, Service timeline tab | 1440 × 1000 |
| vehicle-mobile.png  | Same authorized vehicle timeline                      | 390 × 844   |
| job-board.png       | `/operations`, OMR branch; board horizontally scrolls | 1440 × 1000 |
| inventory.png       | `/inventory`, OMR branch                              | 1440 × 1000 |
| billing.png         | `/estimates`, OMR branch                              | 1440 × 1000 |
| notifications.png   | `/notifications`, OMR branch                          | 1440 × 1000 |

Authenticated captures use an existing verified `example.test` fixture identity and
synthetic Apex records from the local acceptance database. No registration,
invitation, real email, payment or new business-record mutation was performed to
capture these images. Page filters and active workspace are local session context.

The landing page includes a labeled illustrative preview; it is not an operational
screenshot inside that screenshot. Dashboard counts reflect the captured branch and
fixture database. Notification acceptance statuses do not prove external delivery.
The mobile capture is the visible viewport; content continues below and navigation
can scroll. Read the original PNGs to inspect text at their native size.

Before replacing these images, use only a verified synthetic fixture account, wait
for real API content to load, and review every image for personal data, credentials,
action links, private diagnostics and error/loading states. Do not publish login
forms with entered passwords, `.runtime` manifests or browser traces. Keep fixture
credentials and any capture scripts private; only approved screenshots belong here.
