// backend/utils/cloudinary.js
const cloudinary = require('cloudinary').v2;

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'duaodpu01',
  api_key: process.env.CLOUDINARY_API_KEY || '226776597769654',
  api_secret: process.env.CLOUDINARY_API_SECRET || '54f6yFaaspyfF6gFCafXdT5yPnQ',
});

const uploadSingleImage = async (imageFile, folderName = 'dar_collection', options = {}) => {
  try {
    const uploadOptions = {
      folder: folderName,
      resource_type: 'auto',
      ...options
    };

    let uploadResult;
    
    // Handle buffer (memory storage)
    if (imageFile && imageFile.buffer) {
      console.log('Uploading from buffer, mimetype:', imageFile.mimetype);
      uploadResult = await cloudinary.uploader.upload(
        `data:${imageFile.mimetype};base64,${imageFile.buffer.toString('base64')}`,
        uploadOptions
      );
    } 
    // Handle file path (disk storage)
    else if (imageFile && imageFile.path) {
      console.log('Uploading from path:', imageFile.path);
      uploadResult = await cloudinary.uploader.upload(imageFile.path, uploadOptions);
    }
    // Handle string path
    else if (typeof imageFile === 'string') {
      console.log('Uploading from string path');
      uploadResult = await cloudinary.uploader.upload(imageFile, uploadOptions);
    }
    else {
      throw new Error('Invalid image file provided');
    }
    
    return {
      success: true,
      data: {
        public_id: uploadResult.public_id,
        url: uploadResult.secure_url,
        format: uploadResult.format,
        width: uploadResult.width,
        height: uploadResult.height,
        bytes: uploadResult.bytes,
        folder: uploadResult.folder
      }
    };
  } catch (error) {
    console.error('Cloudinary single upload error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Upload multiple images to Cloudinary
 * @param {Array} imagePaths - Array of image paths or base64 strings
 * @param {String} folderName - Folder name in Cloudinary
 * @param {Object} options - Additional Cloudinary options
 * @returns {Promise} Array of Cloudinary upload results
 */
const uploadMultipleImages = async (imagePaths, folderName = 'dar_collection', options = {}) => {
  try {
    const uploadPromises = imagePaths.map((imagePath, index) => 
      uploadSingleImage(imagePath, folderName, {
        ...options,
        public_id: options.public_id ? `${options.public_id}_${index}` : undefined
      })
    );

    const results = await Promise.all(uploadPromises);
    
    const successfulUploads = results.filter(result => result.success);
    const failedUploads = results.filter(result => !result.success);

    return {
      success: true,
      data: successfulUploads.map(result => result.data),
      failed: failedUploads,
      total: results.length,
      successful: successfulUploads.length,
      failedCount: failedUploads.length
    };
  } catch (error) {
    console.error('Cloudinary multiple upload error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Delete image from Cloudinary
 * @param {String} publicId - Cloudinary public_id
 * @returns {Promise} Deletion result
 */
const deleteImage = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId);
    
    if (result.result === 'ok') {
      return {
        success: true,
        message: 'Image deleted successfully'
      };
    } else {
      return {
        success: false,
        error: 'Failed to delete image'
      };
    }
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Delete multiple images from Cloudinary
 * @param {Array} publicIds - Array of Cloudinary public_ids
 * @returns {Promise} Bulk deletion result
 */
const deleteMultipleImages = async (publicIds) => {
  try {
    const deletePromises = publicIds.map(publicId => deleteImage(publicId));
    const results = await Promise.all(deletePromises);
    
    const successfulDeletes = results.filter(result => result.success);
    const failedDeletes = results.filter(result => !result.success);

    return {
      success: true,
      deleted: successfulDeletes.length,
      failed: failedDeletes,
      total: publicIds.length
    };
  } catch (error) {
    console.error('Cloudinary multiple delete error:', error);
    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Main upload function that handles both single and multiple uploads
 * @param {String|Array} images - Single image path or array of image paths
 * @param {String} folderName - Folder name in Cloudinary
 * @param {Object} options - Additional Cloudinary options
 * @returns {Promise} Upload result(s)
 */
const uploadToCloudinary = async (images, folderName = 'dar_collection', options = {}) => {
  if (Array.isArray(images)) {
    return await uploadMultipleImages(images, folderName, options);
  } else {
    return await uploadSingleImage(images, folderName, options);
  }
};

module.exports = {
  uploadSingleImage,
  uploadMultipleImages,
  uploadToCloudinary,
  deleteImage,
  deleteMultipleImages,
  cloudinary
};