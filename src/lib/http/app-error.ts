/** Erros de negócio/aplicação com código e status HTTP. */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message = "Dados inválidos", fields?: Record<string, string>) {
    super("VALIDATION", message, 422, fields);
    this.name = "ValidationError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Faça login para continuar") {
    super("UNAUTHORIZED", message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Você não tem permissão para esta ação") {
    super("FORBIDDEN", message, 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Registro não encontrado") {
    super("NOT_FOUND", message, 404);
    this.name = "NotFoundError";
  }
}

export class BusinessRuleError extends AppError {
  constructor(message: string, code = "BUSINESS_RULE") {
    super(code, message, 409);
    this.name = "BusinessRuleError";
  }
}

/** Assinatura vencida/suspensa → bloqueio de acesso pago. */
export class PaymentRequiredError extends AppError {
  constructor(message = "Assinatura inativa. Regularize para continuar.") {
    super("PAYMENT_REQUIRED", message, 402);
    this.name = "PaymentRequiredError";
  }
}
