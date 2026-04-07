// Example frontend function to handle color switching
function switchProductColor(selectedColorValue) {
  // Get the current product (this would come from your state/store)
  const currentProduct = getCurrentProduct();
  
  // Get images for the selected color
  const colorImages = currentProduct.getImagesByColor(selectedColorValue);
  
  // Get primary image for the selected color
  const primaryImage = currentProduct.getPrimaryImageByColor(selectedColorValue);
  
  // Get available sizes for the selected color
  const availableSizes = currentProduct.getSizesByColor(selectedColorValue);
  
  // Update UI
  updateProductImages(colorImages);
  updateSizeOptions(availableSizes);
  updateColorSelection(selectedColorValue);
}

// Update product display when color is selected
function updateProductDisplay(product, selectedColor) {
  const colorVariant = product.getColorVariants().find(cv => cv.color.value === selectedColor);
  
  if (colorVariant) {
    // Display images for selected color
    displayImages(colorVariant.images);
    
    // Update size selector
    updateSizeSelector(colorVariant.sizes);
    
    // Update stock status
    updateStockStatus(colorVariant.inStock, colorVariant.totalQuantity);
  }
}