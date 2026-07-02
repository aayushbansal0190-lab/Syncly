/**
 * Generate a unique username for a user
 * Uses first name + random suffix if needed
 * @param {string} fullName - User's full name
 * @param {Function} checkExists - Function to check if username exists
 * @returns {Promise<string>} Generated unique username
 */
export const generateUniqueUsername = async (fullName, checkExists) => {
  // Use first name as base
  const baseUsername = fullName
    .split(" ")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 15);

  // Check if base username exists
  let username = baseUsername;
  let counter = 1;

  while (await checkExists(username)) {
    username = `${baseUsername}${counter}`;
    counter++;
  }

  return username;
};
