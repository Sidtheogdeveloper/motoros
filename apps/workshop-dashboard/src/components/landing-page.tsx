import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  Command,
  GitBranch,
  Layers3,
  Package,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-react';
import styles from './landing-page.module.css';

const features = [
  {
    icon: Users,
    name: 'Know every customer.',
    text: 'Keep contacts, vehicles, ownership and service history together. Pick up where the last visit left off.',
  },
  {
    icon: CalendarDays,
    name: 'Make room for the day.',
    text: 'Plan appointments around real branch capacity. Bring walk-ins into the same check-in workflow.',
  },
  {
    icon: ClipboardList,
    name: 'Give every job a clear path.',
    text: 'Turn complaints into job cards. Assign technicians, record inspections and keep repair tasks moving.',
  },
  {
    icon: Package,
    name: 'Keep parts in the picture.',
    text: 'Track branch stock, reserve parts for a job and follow transfers from one workshop to another.',
  },
  {
    icon: Layers3,
    name: 'Connect work to billing.',
    text: 'Prepare estimates, collect customer decisions, issue invoices and record payments against the work.',
  },
  {
    icon: Bell,
    name: 'Close the communication gap.',
    text: 'Follow customer updates, reminders and delivery attempts without losing sight of the service visit.',
  },
];

const steps = [
  [
    '01',
    'Welcome & check in',
    'Find the customer, select their vehicle and capture what needs attention.',
  ],
  [
    '02',
    'Inspect & plan',
    'Document findings, assign the team and prepare the estimate for approval.',
  ],
  [
    '03',
    'Repair & review',
    'Track tasks and parts, then put completed work through quality control.',
  ],
  [
    '04',
    'Invoice & deliver',
    'Record payment, confirm readiness and carry the service into vehicle history.',
  ],
];

function Wordmark() {
  return (
    <a className={styles.wordmark} href="/" aria-label="MotorOS home">
      <span className={styles.brandMark}>
        <Command size={21} strokeWidth={1.7} aria-hidden="true" />
      </span>
      motor<span className={styles.os}>os</span>
    </a>
  );
}

function WorkshopPreview() {
  return (
    <div className={styles.previewWrap}>
      <div
        className={styles.preview}
        role="img"
        aria-label="Illustrative workshop view showing a vehicle inspection, technician assignment and connected branch history. Example data, not live workshop records."
      >
        <div className={styles.windowBar}>
          <span className={styles.windowDots}>
            <i />
            <i />
            <i />
          </span>
          <span>motoros / workshop</span>
          <ShieldCheck size={13} aria-hidden="true" />
        </div>
        <div className={styles.previewBody}>
          <div className={styles.previewHeading}>
            <div>
              <span className={styles.smallLabel}>YOUR WORKSHOP, CONNECTED</span>
              <h2>Today on the floor</h2>
            </div>
            <span className={styles.branchLabel}>
              <span /> Velachery
            </span>
          </div>
          <div className={styles.previewTabs}>
            <span className={styles.activeTab}>Job board</span>
            <span>Appointments</span>
            <span>Team</span>
            <span className={styles.previewLive}>WORKSHOP VIEW</span>
          </div>
          <div className={styles.jobCard}>
            <div className={styles.jobTop}>
              <span>
                JC–0142 <span className={styles.subtle}>/ GENERAL SERVICE</span>
              </span>
              <span className={styles.inspectionBadge}>In inspection</span>
            </div>
            <div className={styles.vehicleRow}>
              <div>
                <span className={styles.smallLabel}>VEHICLE CHECKED IN</span>
                <h3>Maruti Suzuki Swift</h3>
                <span className={styles.registration}>TN 09 AB 1234</span>
              </div>
              <svg
                viewBox="0 0 220 110"
                className={styles.carDrawing}
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M26 69 35 51 70 44 89 24h57l29 24 20 7 7 23H24Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path
                  d="m77 45 18-16h46l22 18H77Zm36-16v18M30 64h27m119-7 17 5M79 77h64m-21-22h12"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <circle
                  cx="62"
                  cy="77"
                  r="17"
                  fill="#1c1f20"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <circle cx="62" cy="77" r="8" stroke="currentColor" />
                <circle
                  cx="162"
                  cy="77"
                  r="17"
                  fill="#1c1f20"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
                <circle cx="162" cy="77" r="8" stroke="currentColor" />
                <path d="M13 100h195" stroke="#373b3c" strokeDasharray="3 5" />
              </svg>
            </div>
            <div className={styles.taskLine}>
              <span>
                <CircleCheck size={14} /> Vehicle intake
              </span>
              <span className={styles.taskCurrent}>
                <span /> Inspection
              </span>
              <span>Repair</span>
              <span>Quality check</span>
            </div>
            <div className={styles.assignee}>
              <span className={styles.avatar}>RK</span>
              <div>
                <strong>R. Kumar</strong>
                <span>Assigned technician</span>
              </div>
              <span className={styles.priority}>Normal priority</span>
            </div>
          </div>
          <div className={styles.historyCard}>
            <span className={styles.historyIcon}>
              <GitBranch size={18} />
            </span>
            <div>
              <strong>One vehicle. A connected history.</strong>
              <p>
                Anna Nagar <ChevronRight size={12} /> Velachery <ChevronRight size={12} /> OMR
              </p>
            </div>
            <Check size={17} className={styles.historyCheck} />
          </div>
        </div>
      </div>
      <div className={styles.previewCaption}>
        <span /> ILLUSTRATIVE WORKSPACE · EXAMPLE DATA
      </div>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className={styles.landing}>
      <a className={styles.skipLink} href="#main-content">
        Skip to content
      </a>
      <header className={styles.header}>
        <Wordmark />
        <nav className={styles.navigation} aria-label="Main navigation">
          <a href="#features">The platform</a>
          <a href="#workflow">How it works</a>
          <a href="#branches">Connected branches</a>
        </nav>
        <div className={styles.headerActions}>
          <a className={styles.signIn} href="/login">
            Sign in <ArrowUpRight size={14} aria-hidden="true" />
          </a>
          <a className={styles.navCta} href="/register">
            Get started <ArrowRight size={14} aria-hidden="true" />
          </a>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <div className={styles.eyebrow}>
              <span /> THE WORKSHOP OPERATING SYSTEM
            </div>
            <h1 id="hero-title">
              Your workshop.
              <br />
              In <em>perfect sync.</em>
            </h1>
            <p className={styles.heroDescription}>
              From the first booking to the final handover. Bring your people, vehicles and daily
              operations into one connected workspace.
            </p>
            <div className={styles.heroActions}>
              <a className={styles.primaryCta} href="/register">
                Create your workshop <ArrowUpRight size={18} aria-hidden="true" />
              </a>
              <a className={styles.textCta} href="#workflow">
                See how it works <ArrowDown size={15} aria-hidden="true" />
              </a>
            </div>
            <div className={styles.heroNotes}>
              <span>
                <ShieldCheck size={15} aria-hidden="true" /> Role-based access
              </span>
              <span>
                <GitBranch size={15} aria-hidden="true" /> Built for multiple branches
              </span>
            </div>
          </div>
          <WorkshopPreview />
        </section>

        <div className={styles.connectionStrip}>
          <span className={styles.stripIntro}>
            LESS FRICTION.
            <br />
            <strong>MORE FLOW.</strong>
          </span>
          <span>
            <CalendarDays size={18} aria-hidden="true" /> Booking & intake
          </span>
          <i />
          <span>
            <Wrench size={18} aria-hidden="true" /> Workshop operations
          </span>
          <i />
          <span>
            <Package size={18} aria-hidden="true" /> Parts & inventory
          </span>
          <i />
          <span>
            <Layers3 size={18} aria-hidden="true" /> Estimates & billing
          </span>
        </div>

        <section className={styles.featuresSection} id="features" aria-labelledby="features-title">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.sectionLabel}>01 / ONE CONNECTED PLATFORM</span>
              <h2 id="features-title">
                Everything that keeps
                <br />
                your workshop moving.
              </h2>
            </div>
            <p>
              Less switching between tools.
              <br />
              More clarity for the people doing the work.
            </p>
          </div>
          <div className={styles.featureGrid}>
            {features.map(({ icon: Icon, name, text }) => (
              <article className={styles.feature} key={name}>
                <span className={styles.featureIcon}>
                  <Icon size={21} strokeWidth={1.5} aria-hidden="true" />
                </span>
                <h3>{name}</h3>
                <p>{text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.workflowSection} id="workflow" aria-labelledby="workflow-title">
          <div className={styles.sectionHeading}>
            <div>
              <span className={styles.sectionLabel}>02 / FROM ARRIVAL TO HANDOVER</span>
              <h2 id="workflow-title">
                A clear next step.
                <br />
                For every service visit.
              </h2>
            </div>
            <span className={styles.workflowBadge}>
              <Wrench size={14} aria-hidden="true" /> Built around real workshop work
            </span>
          </div>
          <ol className={styles.steps}>
            {steps.map(([number, title, text]) => (
              <li key={number}>
                <div className={styles.stepNumber}>
                  {number}
                  <ArrowRight size={17} aria-hidden="true" />
                </div>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={styles.branchSection} id="branches" aria-labelledby="branches-title">
          <div>
            <span className={styles.sectionLabel}>03 / CONNECTED, WITH CONTROL</span>
            <h2 id="branches-title">
              Different branches.
              <br />
              <em>One shared picture.</em>
            </h2>
            <p>
              A vehicle’s story should travel with it. Give authorized staff access to service
              history across your brand’s branches, with clear boundaries between independent
              businesses.
            </p>
            <span className={styles.permissionNote}>
              <ShieldCheck size={16} aria-hidden="true" /> Shared history. Carefully controlled
              access.
            </span>
          </div>
          <div
            className={styles.branchMap}
            aria-label="Example of three branches connected within one workshop brand"
          >
            <div className={styles.mapBrand}>
              <span className={styles.brandMark}>
                <Command size={22} aria-hidden="true" />
              </span>
              <span>
                Your workshop brand<small>One brand. Connected operations.</small>
              </span>
            </div>
            <div className={styles.mapLine} />
            <div className={styles.mapLocations}>
              {['Anna Nagar', 'Velachery', 'OMR'].map((name) => (
                <div key={name}>
                  <span className={styles.locationDot}>
                    <GitBranch size={17} aria-hidden="true" />
                  </span>
                  <strong>{name}</strong>
                  <small>Authorized branch</small>
                </div>
              ))}
            </div>
            <span className={styles.mapCaption}>ILLUSTRATIVE BRANCH NETWORK</span>
          </div>
        </section>

        <section className={styles.closing} aria-labelledby="closing-title">
          <span className={styles.sectionLabel}>BUILT FOR THE WORKSHOP FLOOR</span>
          <h2 id="closing-title">
            Good work deserves
            <br />
            great operations.
          </h2>
          <p>Give your workshop a more connected way to work.</p>
          <a className={styles.primaryCta} href="/register">
            Create your workshop <ArrowUpRight size={18} aria-hidden="true" />
          </a>
          <span className={styles.closingSignIn}>
            Already have a workspace?{' '}
            <a href="/login">
              Sign in <ArrowRight size={13} aria-hidden="true" />
            </a>
          </span>
        </section>
      </main>

      <footer className={styles.footer}>
        <Wordmark />
        <span>The operating system for your workshop.</span>
        <a href="#main-content">
          Back to top <ArrowUpRight size={13} aria-hidden="true" />
        </a>
        <small>© {new Date().getFullYear()} MotorOS</small>
      </footer>
    </div>
  );
}
