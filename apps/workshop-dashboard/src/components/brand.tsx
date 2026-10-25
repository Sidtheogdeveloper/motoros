import styles from './brand.module.css';

/** A single identity for public, account and workshop screens. No client runtime. */
export function Brand({ markOnly = false }: { markOnly?: boolean }) {
  return (
    <span className={styles.lockup} role="img" aria-label="MotorOS">
      {/* A small static vector stays crisp without a responsive image loader. */}
      <img src="/brand/motoros-mark.svg" width={38} height={38} alt="" className={styles.mark} />
      {!markOnly && (
        <span className={styles.wordmark} aria-hidden="true">
          motor<span className={styles.os}>os</span>
        </span>
      )}
    </span>
  );
}
