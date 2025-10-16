import { FormEvent, useState } from "react";
import { createUser } from "../lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const data = await createUser({ email, displayName: displayName || undefined });
      setResult(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create user");
    }
  };

  return (
    <main style={{ padding: "1.5rem", maxWidth: 480 }}>
      <h1>Collector Onboarding</h1>
      <p>Register a collector and automatically provision a TKD wallet.</p>

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1rem" }}>
        <label>
          Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} style={{ width: "100%" }} />
        </label>
        <button type="submit">Create / Fetch Wallet</button>
      </form>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {result && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Wallet Record</h2>
          <pre style={{ padding: "1rem", background: "#f4f4f4", borderRadius: 4 }}>{JSON.stringify(result, null, 2)}</pre>
        </section>
      )}
    </main>
  );
}
