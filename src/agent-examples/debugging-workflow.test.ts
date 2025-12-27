import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Advanced Agent Scenario: Debugging Workflow
 *
 * Simulates an AI agent debugging a complex issue:
 * - Tracing error origins through stack traces
 * - Finding related code paths
 * - Analyzing function call chains
 * - Identifying potential root causes
 */
describe("Agent Scenario: Debugging Workflow", () => {
  const createEnv = () =>
    new Bash({
      files: {
        "/app/logs/error.log": `[2024-01-15T10:30:45.123Z] ERROR: Failed to process order
  at OrderService.processOrder (/app/src/services/order.ts:45)
  at OrderController.create (/app/src/controllers/order.ts:23)
  at Router.handle (/app/node_modules/express/router.js:178)
Error: Payment validation failed: Invalid card number
  at PaymentValidator.validate (/app/src/validators/payment.ts:67)
  at PaymentService.charge (/app/src/services/payment.ts:34)
  at OrderService.processPayment (/app/src/services/order.ts:78)

[2024-01-15T10:31:12.456Z] ERROR: Database connection timeout
  at DBPool.getConnection (/app/src/db/pool.ts:45)
  at UserRepository.findById (/app/src/repositories/user.ts:23)
  at AuthMiddleware.authenticate (/app/src/middleware/auth.ts:56)

[2024-01-15T10:32:00.789Z] ERROR: Failed to process order
  at OrderService.processOrder (/app/src/services/order.ts:45)
  at OrderController.create (/app/src/controllers/order.ts:23)
Error: Inventory check failed: Item out of stock
  at InventoryService.reserve (/app/src/services/inventory.ts:89)
  at OrderService.reserveItems (/app/src/services/order.ts:56)
`,
        "/app/src/services/order.ts": `import { PaymentService } from './payment';
import { InventoryService } from './inventory';
import { NotificationService } from './notification';
import { logger } from '../utils/logger';

export class OrderService {
  private paymentService: PaymentService;
  private inventoryService: InventoryService;
  private notificationService: NotificationService;

  constructor() {
    this.paymentService = new PaymentService();
    this.inventoryService = new InventoryService();
    this.notificationService = new NotificationService();
  }

  async processOrder(order: Order): Promise<OrderResult> {
    logger.info(\`Processing order \${order.id}\`);

    try {
      // Step 1: Validate order
      this.validateOrder(order);

      // Step 2: Check inventory
      await this.reserveItems(order.items);

      // Step 3: Process payment
      const paymentResult = await this.processPayment(order);

      // Step 4: Confirm order
      const confirmedOrder = await this.confirmOrder(order, paymentResult);

      // Step 5: Send notification
      await this.notificationService.sendConfirmation(order);


      return { success: true, order: confirmedOrder };
    } catch (error) {
      logger.error(\`Failed to process order: \${error.message}\`);
      throw error;
    }
  }

  private validateOrder(order: Order): void {

    if (!order.items || order.items.length === 0) {

      throw new Error('Order must have at least one item');
    }
  }

  async reserveItems(items: OrderItem[]): Promise<void> {
    for (const item of items) {
      const available = await this.inventoryService.checkAvailability(item.productId, item.quantity);
      if (!available) {
        throw new Error(\`Inventory check failed: Item out of stock\`);
      }
      await this.inventoryService.reserve(item.productId, item.quantity);
    }
  }

  async processPayment(order: Order): Promise<PaymentResult> {
    try {
      return await this.paymentService.charge(order.payment, order.total);
    } catch (error) {
      logger.error(\`Payment failed for order \${order.id}\`);
      throw error;
    }
  }

  async confirmOrder(order: Order, payment: PaymentResult): Promise<Order> {
    order.status = 'confirmed';
    order.paymentId = payment.transactionId;
    return order;
  }
}
`,
        "/app/src/services/payment.ts": `import { PaymentValidator } from '../validators/payment';
import { PaymentGateway } from '../gateways/payment';
import { logger } from '../utils/logger';

export class PaymentService {
  private validator: PaymentValidator;
  private gateway: PaymentGateway;

  constructor() {
    this.validator = new PaymentValidator();
    this.gateway = new PaymentGateway();
  }

  async charge(payment: PaymentInfo, amount: number): Promise<PaymentResult> {
    logger.info(\`Charging \${amount} to payment method\`);

    // Validate payment details
    const validationResult = this.validator.validate(payment);
    if (!validationResult.valid) {
      throw new Error(\`Payment validation failed: \${validationResult.error}\`);
    }

    // Process payment through gateway
    try {
      const result = await this.gateway.processPayment({
        cardNumber: payment.cardNumber,
        expiry: payment.expiry,
        cvv: payment.cvv,
        amount,
      });

      logger.info(\`Payment successful: \${result.transactionId}\`);
      return result;
    } catch (error) {
      logger.error(\`Gateway error: \${error.message}\`);
      throw new Error(\`Payment gateway failed: \${error.message}\`);
    }
  }
}
`,
        "/app/src/services/inventory.ts": `import { ProductRepository } from '../repositories/product';
import { logger } from '../utils/logger';

export class InventoryService {
  private productRepo: ProductRepository;

  constructor() {
    this.productRepo = new ProductRepository();
  }

  async checkAvailability(productId: string, quantity: number): Promise<boolean> {
    const product = await this.productRepo.findById(productId);
    if (!product) {
      logger.warn(\`Product not found: \${productId}\`);
      return false;
    }
    return product.stock >= quantity;
  }

  async reserve(productId: string, quantity: number): Promise<void> {
    const product = await this.productRepo.findById(productId);
    if (!product || product.stock < quantity) {
      throw new Error(\`Cannot reserve \${quantity} units of \${productId}\`);
    }

    product.stock -= quantity;
    await this.productRepo.update(product);
    logger.info(\`Reserved \${quantity} units of \${productId}\`);
  }

  async release(productId: string, quantity: number): Promise<void> {
    const product = await this.productRepo.findById(productId);
    if (product) {
      product.stock += quantity;
      await this.productRepo.update(product);
      logger.info(\`Released \${quantity} units of \${productId}\`);
    }
  }
}
`,
        "/app/src/validators/payment.ts": `import { logger } from '../utils/logger';

export class PaymentValidator {
  validate(payment: PaymentInfo): ValidationResult {
    logger.debug('Validating payment info');

    // Check card number
    if (!payment.cardNumber || !this.isValidCardNumber(payment.cardNumber)) {
      return { valid: false, error: 'Invalid card number' };
    }

    // Check expiry
    if (!payment.expiry || !this.isValidExpiry(payment.expiry)) {
      return { valid: false, error: 'Invalid expiry date' };
    }

    // Check CVV
    if (!payment.cvv || !this.isValidCVV(payment.cvv)) {
      return { valid: false, error: 'Invalid CVV' };
    }

    return { valid: true };
  }

  private isValidCardNumber(cardNumber: string): boolean {
    // Luhn algorithm check
    const digits = cardNumber.replace(/\\D/g, '');
    if (digits.length < 13 || digits.length > 19) {
      return false;
    }
    return this.luhnCheck(digits);
  }

  private isValidExpiry(expiry: string): boolean {
    const match = expiry.match(/^(\\d{2})\\/(\\d{2})$/);
    if (!match) return false;

    const month = parseInt(match[1], 10);
    const year = parseInt(match[2], 10) + 2000;

    if (month < 1 || month > 12) return false;

    const now = new Date();
    const expiryDate = new Date(year, month, 0);
    return expiryDate > now;
  }

  private isValidCVV(cvv: string): boolean {
    return /^\\d{3,4}$/.test(cvv);
  }

  private luhnCheck(digits: string): boolean {
    let sum = 0;
    let isEven = false;

    for (let i = digits.length - 1; i >= 0; i--) {
      let digit = parseInt(digits[i], 10);

      if (isEven) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }

      sum += digit;
      isEven = !isEven;
    }

    return sum % 10 === 0;
  }
}
`,
        "/app/src/controllers/order.ts": `import { Request, Response } from 'express';
import { OrderService } from '../services/order';
import { logger } from '../utils/logger';

export class OrderController {
  private orderService: OrderService;

  constructor() {
    this.orderService = new OrderService();
  }

  async create(req: Request, res: Response): Promise<void> {
    const order = req.body;
    logger.info(\`Creating order for user \${req.user.id}\`);

    try {
      const result = await this.orderService.processOrder(order);
      res.status(201).json(result);
    } catch (error) {
      logger.error(\`Order creation failed: \${error.message}\`);
      res.status(400).json({ error: error.message });
    }
  }

  async get(req: Request, res: Response): Promise<void> {
    const orderId = req.params.id;
    // Implementation here
  }
}
`,
        "/app/src/utils/logger.ts": `export const logger = {
  info: (msg: string) => console.log(\`[INFO] \${msg}\`),
  warn: (msg: string) => console.warn(\`[WARN] \${msg}\`),
  error: (msg: string) => console.error(\`[ERROR] \${msg}\`),
  debug: (msg: string) => console.log(\`[DEBUG] \${msg}\`),
};
`,
      },
      cwd: "/app",
    });

  it("should extract error messages from logs", async () => {
    const env = createEnv();
    const result = await env.exec('grep "^Error:" /app/logs/error.log');
    expect(
      result.stdout,
    ).toBe(`Error: Payment validation failed: Invalid card number
Error: Inventory check failed: Item out of stock
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find unique error types", async () => {
    const env = createEnv();
    // Field 4 because timestamp has colons: [2024-01-15T10:30:45.123Z] ERROR: message
    const result = await env.exec(
      'grep "ERROR:" /app/logs/error.log | cut -d":" -f4 | sort | uniq',
    );
    expect(result.stdout).toBe(` Database connection timeout
 Failed to process order
`);
    expect(result.exitCode).toBe(0);
  });

  it("should extract file paths from stack traces", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -o "/app/src/[^)]*" /app/logs/error.log | cut -d":" -f1 | sort | uniq',
    );
    expect(result.stdout).toBe(`/app/src/controllers/order.ts
/app/src/db/pool.ts
/app/src/middleware/auth.ts
/app/src/repositories/user.ts
/app/src/services/inventory.ts
/app/src/services/order.ts
/app/src/services/payment.ts
/app/src/validators/payment.ts
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find the most common error location", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -o "at [A-Za-z.]*" /app/logs/error.log | sort | uniq -c | sort -rn | head -3',
    );
    expect(result.stdout).toBe(`   2 at OrderService.processOrder
   2 at OrderController.create
   1 at UserRepository.findById
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find where PaymentValidator.validate is defined", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -n "validate(" /app/src/validators/payment.ts | head -1',
    );
    expect(result.stdout).toBe(
      "4:  validate(payment: PaymentInfo): ValidationResult {\n",
    );
    expect(result.exitCode).toBe(0);
  });

  it("should trace the payment validation flow", async () => {
    const env = createEnv();

    // Find where validator is called
    const validatorUsage = await env.exec(
      'grep -n "validator.validate" /app/src/services/payment.ts',
    );
    expect(validatorUsage.stdout).toBe(
      "18:    const validationResult = this.validator.validate(payment);\n",
    );

    // Find where PaymentService.charge is called
    const chargeUsage = await env.exec(
      'grep -n "paymentService.charge" /app/src/services/order.ts',
    );
    expect(chargeUsage.stdout).toBe(
      "64:      return await this.paymentService.charge(order.payment, order.total);\n",
    );
    expect(chargeUsage.exitCode).toBe(0);
  });

  it("should find all throw statements in order service", async () => {
    const env = createEnv();
    const result = await env.exec('grep -n "throw" /app/src/services/order.ts');
    expect(result.stdout).toBe(`40:      throw error;
48:      throw new Error('Order must have at least one item');
56:        throw new Error(\`Inventory check failed: Item out of stock\`);
67:      throw error;
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find all error logging statements", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -rn "logger.error" /app/src --include="*.ts"',
    );
    expect(
      result.stdout,
    ).toBe(`/app/src/controllers/order.ts:20:      logger.error(\`Order creation failed: \${error.message}\`);
/app/src/services/order.ts:39:      logger.error(\`Failed to process order: \${error.message}\`);
/app/src/services/order.ts:66:      logger.error(\`Payment failed for order \${order.id}\`);
/app/src/services/payment.ts:35:      logger.error(\`Gateway error: \${error.message}\`);
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find try-catch blocks in services", async () => {
    const env = createEnv();
    const result = await env.exec('grep -c "try {" /app/src/services/*.ts');
    expect(result.stdout).toBe(`/app/src/services/inventory.ts:0
/app/src/services/order.ts:2
/app/src/services/payment.ts:1
`);
    expect(result.exitCode).toBe(0);
  });

  it("should analyze the order processing flow", async () => {
    const env = createEnv();

    // Find all method calls in processOrder
    const result = await env.exec(
      'grep -A 30 "async processOrder" /app/src/services/order.ts | grep -E "this\\.|await "',
    );
    expect(result.stdout).toBe(`      this.validateOrder(order);
      await this.reserveItems(order.items);
      const paymentResult = await this.processPayment(order);
      const confirmedOrder = await this.confirmOrder(order, paymentResult);
      await this.notificationService.sendConfirmation(order);
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find all service dependencies in order service", async () => {
    const env = createEnv();
    const result = await env.exec('grep "^import" /app/src/services/order.ts');
    expect(result.stdout).toBe(`import { PaymentService } from './payment';
import { InventoryService } from './inventory';
import { NotificationService } from './notification';
import { logger } from '../utils/logger';
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find validation error messages", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep "error:" /app/src/validators/payment.ts',
    );
    expect(
      result.stdout,
    ).toBe(`      return { valid: false, error: 'Invalid card number' };
      return { valid: false, error: 'Invalid expiry date' };
      return { valid: false, error: 'Invalid CVV' };
`);
    expect(result.exitCode).toBe(0);
  });

  it("should count total lines in files from stack trace", async () => {
    const env = createEnv();
    const result = await env.exec(
      "wc -l /app/src/services/order.ts /app/src/services/payment.ts /app/src/validators/payment.ts",
    );
    expect(result.stdout).toBe(`76 /app/src/services/order.ts
39 /app/src/services/payment.ts
70 /app/src/validators/payment.ts
185 total
`);
    expect(result.exitCode).toBe(0);
  });

  it("should find all files that import the order service", async () => {
    const env = createEnv();
    const result = await env.exec(
      'grep -rl "OrderService" /app/src --include="*.ts"',
    );
    expect(result.stdout).toBe(`/app/src/controllers/order.ts
/app/src/services/order.ts
`);
    expect(result.exitCode).toBe(0);
  });
});
