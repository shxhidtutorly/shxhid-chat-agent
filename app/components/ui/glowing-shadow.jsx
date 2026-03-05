import styles from "./glowing-shadow.module.css";

export function GlowingShadow({ children }) {
  return (
    <div className={styles.glowContainer} role="button">
      <span className={styles.glow}></span>
      <div className={styles.glowContent}>{children}</div>
    </div>
  );
}
