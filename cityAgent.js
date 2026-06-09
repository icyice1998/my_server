// City to Country AI Agent

class CityCountryAgent {
  constructor() {
    this.cities = {};
    this.initialized = false;
    this.loadCitiesData();
  }

  // Load cities data from JSON
  async loadCitiesData() {
    try {
      const response = await fetch('cities.json');
      const data = await response.json();

      // Create a searchable index (lowercase for case-insensitive search)
      data.cities.forEach(entry => {
        this.cities[entry.city.toLowerCase()] = entry.country;
      });

      this.initialized = true;
    } catch (error) {
      console.error('Error loading cities data:', error);
    }
  }

  // Process city input and return country
  processInput(cityName) {
    if (!this.initialized) {
      return { success: false, message: 'Agent not initialized yet. Please try again.' };
    }

    const normalizedInput = cityName.trim().toLowerCase();

    if (!normalizedInput) {
      return { success: false, message: 'Please enter a city name.' };
    }

    // Exact match
    if (this.cities[normalizedInput]) {
      return {
        success: true,
        city: cityName.trim(),
        country: this.cities[normalizedInput],
        confidence: 100
      };
    }

    // Fuzzy match - find similar cities
    const matches = Object.keys(this.cities).filter(city =>
      city.includes(normalizedInput) || normalizedInput.includes(city)
    );

    if (matches.length > 0) {
      const bestMatch = matches[0];
      return {
        success: true,
        city: bestMatch.charAt(0).toUpperCase() + bestMatch.slice(1),
        country: this.cities[bestMatch],
        confidence: 85,
        message: 'Approximate match found'
      };
    }

    return {
      success: false,
      city: cityName.trim(),
      message: `City "${cityName}" not found in database.`,
      suggestion: 'Please check the spelling and try again.'
    };
  }

  // Get all available cities
  getAllCities() {
    return Object.keys(this.cities)
      .map(city => ({ city: city.charAt(0).toUpperCase() + city.slice(1), country: this.cities[city] }))
      .sort((a, b) => a.city.localeCompare(b.city));
  }
}

// Initialize the agent globally
const cityAgent = new CityCountryAgent();
