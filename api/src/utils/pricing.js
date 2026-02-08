/**
 * Pricing calculation utilities
 */

const calculateOrderTotal = (items, options = {}) => {
  const { taxRate = 0.15, serviceChargeRate = 0 } = options;
  
  // Calculate subtotal
  const subtotal = items.reduce((sum, item) => {
    return sum + (item.qty * item.unitPrice);
  }, 0);
  
  // Calculate tax
  const tax = Math.round(subtotal * taxRate * 100) / 100;
  
  // Calculate service charge
  const serviceCharge = Math.round(subtotal * serviceChargeRate * 100) / 100;
  
  // Calculate total
  const total = Math.round((subtotal + tax + serviceCharge) * 100) / 100;
  
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    tax,
    serviceCharge,
    total
  };
};

const applyDiscount = (amount, discount) => {
  if (!discount || amount <= 0) return amount;
  
  let discountedAmount = amount;
  
  if (discount.type === 'percentage') {
    discountedAmount = amount - (amount * (discount.value / 100));
  } else if (discount.type === 'fixed') {
    discountedAmount = amount - discount.value;
  }
  
  // Ensure we don't go below zero
  return Math.max(0, Math.round(discountedAmount * 100) / 100);
};

const calculateTax = (amount, taxRate) => {
  return Math.round(amount * taxRate * 100) / 100;
};

const calculateChange = (tendered, total) => {
  return Math.max(0, Math.round((tendered - total) * 100) / 100);
};

const roundToCurrency = (amount) => {
  return Math.round(amount * 100) / 100;
};

module.exports = {
  calculateOrderTotal,
  applyDiscount,
  calculateTax,
  calculateChange,
  roundToCurrency
};
