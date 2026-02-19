const fs = require('fs');
const path = require('path');

const USERS_DB_PATH = './data/users.json';

class User {
  static ensureDbDir() {
    const dir = path.dirname(USERS_DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  static loadUsers() {
    this.ensureDbDir();
    if (!fs.existsSync(USERS_DB_PATH)) {
      return [];
    }
    try {
      const data = fs.readFileSync(USERS_DB_PATH, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  static saveUsers(users) {
    this.ensureDbDir();
    fs.writeFileSync(USERS_DB_PATH, JSON.stringify(users, null, 2));
  }

  static create(userData) {
    const users = this.loadUsers();
    const newUser = {
      id: Date.now().toString(),
      name: userData.name,
      walletAddress: userData.walletAddress,
      createdAt: new Date().toISOString(),
      ...userData
    };
    users.push(newUser);
    this.saveUsers(users);
    return newUser;
  }

  static getAll() {
    return this.loadUsers();
  }

  static getById(id) {
    const users = this.loadUsers();
    return users.find(u => u.id === id);
  }

  static getByWallet(walletAddress) {
    const users = this.loadUsers();
    return users.find(u => u.walletAddress === walletAddress);
  }
}

module.exports = User;
