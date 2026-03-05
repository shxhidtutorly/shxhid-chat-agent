import { redirect } from "react-router";
import styles from "./styles.module.css";
import { GlowingShadow } from "../../components/ui/glowing-shadow";

export const loader = async ({ request }) => {
  const url = new URL(request.url);

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return null
};

export default function App() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <GlowingShadow>
          <span className={styles.glowText}>
            Shop Chat Agent
          </span>
        </GlowingShadow>
        <p className={styles.text}>
          AI-powered shopping assistant for your store.
        </p>
      </div>
    </div>
  );
}
