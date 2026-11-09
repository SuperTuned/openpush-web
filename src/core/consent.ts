/**
 * Consent gate. While consent is required and not given, the SDK writes no
 * storage and makes no request. The site's consent tool calls `setConsentGiven` on each page.
 */
export class ConsentGate {
  private required = false;
  private given = false;
  private waiters: (() => void)[] = [];
  private readonly listeners = new Set<(allowed: boolean) => void>();

  setRequired(required: boolean): void {
    this.required = required;
    this.changed();
  }

  setGiven(given: boolean): void {
    this.given = given;
    this.changed();
  }

  isRequired(): boolean {
    return this.required;
  }

  allowed(): boolean {
    return !this.required || this.given;
  }

  /** Resolves once storage and requests are allowed. */
  whenAllowed(): Promise<void> {
    if (this.allowed()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  onChange(listener: (allowed: boolean) => void): void {
    this.listeners.add(listener);
  }

  private changed(): void {
    const allowed = this.allowed();
    if (allowed) {
      const waiting = this.waiters;
      this.waiters = [];
      waiting.forEach((resolve) => resolve());
    }
    this.listeners.forEach((listener) => listener(allowed));
  }
}
