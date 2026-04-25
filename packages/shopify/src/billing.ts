export const PLAN_CONFIG: Record<string, { name: string; price: number; auditLimit: number; storeLimit: number; purgeEnabled: boolean }> = {
  free:    { name: "Free",    price: 0,   auditLimit: 1,  storeLimit: 1,  purgeEnabled: false },
  starter: { name: "Starter", price: 19,  auditLimit: 999, storeLimit: 1, purgeEnabled: true },
  growth:  { name: "Growth",  price: 49,  auditLimit: 999, storeLimit: 5, purgeEnabled: true },
  agency:  { name: "Agency",  price: 149, auditLimit: 999, storeLimit: 999, purgeEnabled: true }
};

export class ShopifyBilling {
  private async request(shop: string, accessToken: string, method: string, path: string, body?: unknown): Promise<any> {
    const url = `https://${shop}/admin/api/2025-01${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Shopify Billing API Error: ${res.status} ${res.statusText} - ${text}`);
    }

    return res.json();
  }

  async createSubscription(shop: string, accessToken: string, planName: string, returnUrl: string) {
    const planId = planName.toLowerCase() as keyof typeof PLAN_CONFIG;
    const plan = PLAN_CONFIG[planId];
    if (!plan || plan.price === 0) {
      throw new Error("Invalid plan or cannot subscribe to free plan via billing API");
    }

    const res = await this.request(shop, accessToken, "POST", "/recurring_application_charges.json", {
      recurring_application_charge: {
        name: plan.name,
        price: plan.price,
        return_url: returnUrl,
        test: true, // test mode
        trial_days: 7
      }
    });

    return { confirmationUrl: res.recurring_application_charge.confirmation_url };
  }

  async activateSubscription(shop: string, accessToken: string, chargeId: string) {
    const res = await this.request(shop, accessToken, "GET", `/recurring_application_charges/${chargeId}.json`);
    const charge = res.recurring_application_charge;

    if (charge.status === "accepted") {
      // Must POST to activate or Shopify will do it on their own sometimes? 
      // Actually, standard process requires POST to activate if it's accepted.
      // Wait, in modern API, Shopify auto-activates if return_url is hit? 
      // Docs say: "If the status is 'accepted', the charge must be activated by making a POST request..."
      // Let's do the POST request as per prompt: "POST to activate endpoint"
      // Wait, what's the activate endpoint? POST /recurring_application_charges/{id}/activate.json
      // Wait, let's just do it. Wait, the prompt says "If charge.status === 'accepted': POST to activate endpoint"
      await this.request(shop, accessToken, "POST", `/recurring_application_charges/${chargeId}/activate.json`, {
        recurring_application_charge: charge
      });
      return { status: "active", planName: charge.name.toLowerCase() };
    }

    return { status: "declined" };
  }

  async getActiveSubscription(shop: string, accessToken: string) {
    const res = await this.request(shop, accessToken, "GET", "/recurring_application_charges.json");
    const charges: any[] = res.recurring_application_charges;

    const activeCharge = charges.find(c => c.status === "active");
    if (!activeCharge) return null;

    return {
      planName: activeCharge.name.toLowerCase(),
      price: parseFloat(activeCharge.price),
      status: activeCharge.status,
      trialEndsOn: activeCharge.trial_ends_on
    };
  }

  async cancelSubscription(shop: string, accessToken: string, chargeId: string) {
    await this.request(shop, accessToken, "DELETE", `/recurring_application_charges/${chargeId}.json`);
  }
}
