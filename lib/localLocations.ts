import type { LocationAutocompleteSuggestion, LocationDetails } from "./locationTypes";

type LocalLocationRecord = {
  city: string;
  region: string;
  country: string;
  countryCode: string;
  aliases?: string[];
  latitude?: number;
  longitude?: number;
};

const LOCAL_PLACE_PREFIX = "local:";

const LOCAL_LOCATIONS: LocalLocationRecord[] = [
  { city: "Chennai", region: "Tamil Nadu", country: "India", countryCode: "IN", aliases: ["madras"], latitude: 13.0827, longitude: 80.2707 },
  { city: "Mumbai", region: "Maharashtra", country: "India", countryCode: "IN", aliases: ["bombay"], latitude: 19.076, longitude: 72.8777 },
  { city: "Bengaluru", region: "Karnataka", country: "India", countryCode: "IN", aliases: ["bangalore"], latitude: 12.9716, longitude: 77.5946 },
  { city: "Delhi", region: "Delhi", country: "India", countryCode: "IN", aliases: ["new delhi"], latitude: 28.6139, longitude: 77.209 },
  { city: "Hyderabad", region: "Telangana", country: "India", countryCode: "IN", latitude: 17.385, longitude: 78.4867 },
  { city: "Pune", region: "Maharashtra", country: "India", countryCode: "IN", latitude: 18.5204, longitude: 73.8567 },
  { city: "Kolkata", region: "West Bengal", country: "India", countryCode: "IN", aliases: ["calcutta"], latitude: 22.5726, longitude: 88.3639 },
  { city: "Ahmedabad", region: "Gujarat", country: "India", countryCode: "IN", latitude: 23.0225, longitude: 72.5714 },
  { city: "Jaipur", region: "Rajasthan", country: "India", countryCode: "IN", latitude: 26.9124, longitude: 75.7873 },
  { city: "Surat", region: "Gujarat", country: "India", countryCode: "IN", latitude: 21.1702, longitude: 72.8311 },
  { city: "Lucknow", region: "Uttar Pradesh", country: "India", countryCode: "IN", latitude: 26.8467, longitude: 80.9462 },
  { city: "Kanpur", region: "Uttar Pradesh", country: "India", countryCode: "IN", latitude: 26.4499, longitude: 80.3319 },
  { city: "Nagpur", region: "Maharashtra", country: "India", countryCode: "IN", latitude: 21.1458, longitude: 79.0882 },
  { city: "Indore", region: "Madhya Pradesh", country: "India", countryCode: "IN", latitude: 22.7196, longitude: 75.8577 },
  { city: "Thane", region: "Maharashtra", country: "India", countryCode: "IN", latitude: 19.2183, longitude: 72.9781 },
  { city: "Bhopal", region: "Madhya Pradesh", country: "India", countryCode: "IN", latitude: 23.2599, longitude: 77.4126 },
  { city: "Visakhapatnam", region: "Andhra Pradesh", country: "India", countryCode: "IN", aliases: ["vizag"], latitude: 17.6868, longitude: 83.2185 },
  { city: "Patna", region: "Bihar", country: "India", countryCode: "IN", latitude: 25.5941, longitude: 85.1376 },
  { city: "Vadodara", region: "Gujarat", country: "India", countryCode: "IN", aliases: ["baroda"], latitude: 22.3072, longitude: 73.1812 },
  { city: "Ghaziabad", region: "Uttar Pradesh", country: "India", countryCode: "IN", latitude: 28.6692, longitude: 77.4538 },
  { city: "Ludhiana", region: "Punjab", country: "India", countryCode: "IN", latitude: 30.901, longitude: 75.8573 },
  { city: "Agra", region: "Uttar Pradesh", country: "India", countryCode: "IN", latitude: 27.1767, longitude: 78.0081 },
  { city: "Nashik", region: "Maharashtra", country: "India", countryCode: "IN", latitude: 19.9975, longitude: 73.7898 },
  { city: "Faridabad", region: "Haryana", country: "India", countryCode: "IN", latitude: 28.4089, longitude: 77.3178 },
  { city: "Meerut", region: "Uttar Pradesh", country: "India", countryCode: "IN", latitude: 28.9845, longitude: 77.7064 },
  { city: "Rajkot", region: "Gujarat", country: "India", countryCode: "IN", latitude: 22.3039, longitude: 70.8022 },
  { city: "Varanasi", region: "Uttar Pradesh", country: "India", countryCode: "IN", aliases: ["banaras"], latitude: 25.3176, longitude: 82.9739 },
  { city: "Srinagar", region: "Jammu and Kashmir", country: "India", countryCode: "IN", latitude: 34.0837, longitude: 74.7973 },
  { city: "Aurangabad", region: "Maharashtra", country: "India", countryCode: "IN", latitude: 19.8762, longitude: 75.3433 },
  { city: "Dhanbad", region: "Jharkhand", country: "India", countryCode: "IN", latitude: 23.7957, longitude: 86.4304 },
  { city: "Amritsar", region: "Punjab", country: "India", countryCode: "IN", latitude: 31.634, longitude: 74.8723 },
  { city: "Navi Mumbai", region: "Maharashtra", country: "India", countryCode: "IN", latitude: 19.033, longitude: 73.0297 },
  { city: "Allahabad", region: "Uttar Pradesh", country: "India", countryCode: "IN", aliases: ["prayagraj"], latitude: 25.4358, longitude: 81.8463 },
  { city: "Ranchi", region: "Jharkhand", country: "India", countryCode: "IN", latitude: 23.3441, longitude: 85.3096 },
  { city: "Howrah", region: "West Bengal", country: "India", countryCode: "IN", latitude: 22.5958, longitude: 88.2636 },
  { city: "Coimbatore", region: "Tamil Nadu", country: "India", countryCode: "IN", latitude: 11.0168, longitude: 76.9558 },
  { city: "Jabalpur", region: "Madhya Pradesh", country: "India", countryCode: "IN", latitude: 23.1815, longitude: 79.9864 },
  { city: "Gwalior", region: "Madhya Pradesh", country: "India", countryCode: "IN", latitude: 26.2183, longitude: 78.1828 },
  { city: "Vijayawada", region: "Andhra Pradesh", country: "India", countryCode: "IN", latitude: 16.5062, longitude: 80.648 },
  { city: "Jodhpur", region: "Rajasthan", country: "India", countryCode: "IN", latitude: 26.2389, longitude: 73.0243 },
  { city: "Madurai", region: "Tamil Nadu", country: "India", countryCode: "IN", latitude: 9.9252, longitude: 78.1198 },
  { city: "Raipur", region: "Chhattisgarh", country: "India", countryCode: "IN", latitude: 21.2514, longitude: 81.6296 },
  { city: "Kota", region: "Rajasthan", country: "India", countryCode: "IN", latitude: 25.2138, longitude: 75.8648 },
  { city: "Guwahati", region: "Assam", country: "India", countryCode: "IN", latitude: 26.1445, longitude: 91.7362 },
  { city: "Chandigarh", region: "Chandigarh", country: "India", countryCode: "IN", latitude: 30.7333, longitude: 76.7794 },
  { city: "Mysuru", region: "Karnataka", country: "India", countryCode: "IN", aliases: ["mysore"], latitude: 12.2958, longitude: 76.6394 },
  { city: "Gurugram", region: "Haryana", country: "India", countryCode: "IN", aliases: ["gurgaon"], latitude: 28.4595, longitude: 77.0266 },
  { city: "Noida", region: "Uttar Pradesh", country: "India", countryCode: "IN", latitude: 28.5355, longitude: 77.391 },
  { city: "Kochi", region: "Kerala", country: "India", countryCode: "IN", aliases: ["cochin"], latitude: 9.9312, longitude: 76.2673 },
  { city: "Thiruvananthapuram", region: "Kerala", country: "India", countryCode: "IN", aliases: ["trivandrum"], latitude: 8.5241, longitude: 76.9366 },
  { city: "Panaji", region: "Goa", country: "India", countryCode: "IN", latitude: 15.4909, longitude: 73.8278 },
  { city: "Dehradun", region: "Uttarakhand", country: "India", countryCode: "IN", latitude: 30.3165, longitude: 78.0322 },
  { city: "Kovilpatti", region: "Tamil Nadu", country: "India", countryCode: "IN", latitude: 9.1744, longitude: 77.8688 },
  { city: "Tiruchirappalli", region: "Tamil Nadu", country: "India", countryCode: "IN", aliases: ["trichy"], latitude: 10.7905, longitude: 78.7047 },
  { city: "Salem", region: "Tamil Nadu", country: "India", countryCode: "IN", latitude: 11.6643, longitude: 78.146 },
  { city: "Tirunelveli", region: "Tamil Nadu", country: "India", countryCode: "IN", latitude: 8.7139, longitude: 77.7567 },
  { city: "Tiruppur", region: "Tamil Nadu", country: "India", countryCode: "IN", latitude: 11.1085, longitude: 77.3411 },
  { city: "Erode", region: "Tamil Nadu", country: "India", countryCode: "IN", latitude: 11.341, longitude: 77.7172 },
  { city: "Thoothukudi", region: "Tamil Nadu", country: "India", countryCode: "IN", aliases: ["tuticorin"], latitude: 8.7642, longitude: 78.1348 },
  { city: "Vellore", region: "Tamil Nadu", country: "India", countryCode: "IN", latitude: 12.9165, longitude: 79.1325 },
  { city: "Dindigul", region: "Tamil Nadu", country: "India", countryCode: "IN", latitude: 10.3673, longitude: 77.9803 },
  { city: "Thanjavur", region: "Tamil Nadu", country: "India", countryCode: "IN", latitude: 10.7867, longitude: 79.1378 },
  { city: "Nagercoil", region: "Tamil Nadu", country: "India", countryCode: "IN", latitude: 8.1833, longitude: 77.4119 },
  { city: "Cuddalore", region: "Tamil Nadu", country: "India", countryCode: "IN", latitude: 11.748, longitude: 79.7714 },
  { city: "Kanchipuram", region: "Tamil Nadu", country: "India", countryCode: "IN", latitude: 12.8342, longitude: 79.7036 },
  { city: "Tiruvannamalai", region: "Tamil Nadu", country: "India", countryCode: "IN", latitude: 12.2253, longitude: 79.0747 },
  { city: "Hosur", region: "Tamil Nadu", country: "India", countryCode: "IN", latitude: 12.7409, longitude: 77.8253 },
  { city: "Mangaluru", region: "Karnataka", country: "India", countryCode: "IN", aliases: ["mangalore"], latitude: 12.9141, longitude: 74.856 },
  { city: "Hubballi", region: "Karnataka", country: "India", countryCode: "IN", aliases: ["hubli"], latitude: 15.3647, longitude: 75.124 },
  { city: "Dharwad", region: "Karnataka", country: "India", countryCode: "IN", latitude: 15.4589, longitude: 75.0078 },
  { city: "Belagavi", region: "Karnataka", country: "India", countryCode: "IN", aliases: ["belgaum"], latitude: 15.8497, longitude: 74.4977 },
  { city: "Ballari", region: "Karnataka", country: "India", countryCode: "IN", aliases: ["bellary"], latitude: 15.1394, longitude: 76.9214 },
  { city: "Shivamogga", region: "Karnataka", country: "India", countryCode: "IN", aliases: ["shimoga"], latitude: 13.9299, longitude: 75.5681 },
  { city: "Tumakuru", region: "Karnataka", country: "India", countryCode: "IN", aliases: ["tumkur"], latitude: 13.3379, longitude: 77.1173 },
  { city: "Udupi", region: "Karnataka", country: "India", countryCode: "IN", latitude: 13.3409, longitude: 74.7421 },
  { city: "Kalaburagi", region: "Karnataka", country: "India", countryCode: "IN", aliases: ["gulbarga"], latitude: 17.3297, longitude: 76.8343 },
  { city: "Davanagere", region: "Karnataka", country: "India", countryCode: "IN", latitude: 14.4644, longitude: 75.9218 },
  { city: "Kannur", region: "Kerala", country: "India", countryCode: "IN", latitude: 11.8745, longitude: 75.3704 },
  { city: "Kozhikode", region: "Kerala", country: "India", countryCode: "IN", aliases: ["calicut"], latitude: 11.2588, longitude: 75.7804 },
  { city: "Thrissur", region: "Kerala", country: "India", countryCode: "IN", latitude: 10.5276, longitude: 76.2144 },
  { city: "Kollam", region: "Kerala", country: "India", countryCode: "IN", latitude: 8.8932, longitude: 76.6141 },
  { city: "Alappuzha", region: "Kerala", country: "India", countryCode: "IN", aliases: ["alleppey"], latitude: 9.4981, longitude: 76.3388 },
  { city: "Palakkad", region: "Kerala", country: "India", countryCode: "IN", latitude: 10.7867, longitude: 76.6548 },
  { city: "Kottayam", region: "Kerala", country: "India", countryCode: "IN", latitude: 9.5916, longitude: 76.5222 },
  { city: "Malappuram", region: "Kerala", country: "India", countryCode: "IN", latitude: 11.051, longitude: 76.0711 },
  { city: "Guntur", region: "Andhra Pradesh", country: "India", countryCode: "IN", latitude: 16.3067, longitude: 80.4365 },
  { city: "Nellore", region: "Andhra Pradesh", country: "India", countryCode: "IN", latitude: 14.4426, longitude: 79.9865 },
  { city: "Kurnool", region: "Andhra Pradesh", country: "India", countryCode: "IN", latitude: 15.8281, longitude: 78.0373 },
  { city: "Rajahmundry", region: "Andhra Pradesh", country: "India", countryCode: "IN", aliases: ["rajamahendravaram"], latitude: 17.0005, longitude: 81.804 },
  { city: "Tirupati", region: "Andhra Pradesh", country: "India", countryCode: "IN", latitude: 13.6288, longitude: 79.4192 },
  { city: "Kakinada", region: "Andhra Pradesh", country: "India", countryCode: "IN", latitude: 16.9891, longitude: 82.2475 },
  { city: "Anantapur", region: "Andhra Pradesh", country: "India", countryCode: "IN", latitude: 14.6819, longitude: 77.6006 },
  { city: "Warangal", region: "Telangana", country: "India", countryCode: "IN", latitude: 17.9689, longitude: 79.5941 },
  { city: "Karimnagar", region: "Telangana", country: "India", countryCode: "IN", latitude: 18.4386, longitude: 79.1288 },
  { city: "Nizamabad", region: "Telangana", country: "India", countryCode: "IN", latitude: 18.6725, longitude: 78.0941 },
  { city: "Khammam", region: "Telangana", country: "India", countryCode: "IN", latitude: 17.2473, longitude: 80.1514 },
  { city: "Solapur", region: "Maharashtra", country: "India", countryCode: "IN", latitude: 17.6599, longitude: 75.9064 },
  { city: "Kolhapur", region: "Maharashtra", country: "India", countryCode: "IN", latitude: 16.705, longitude: 74.2433 },
  { city: "Sangli", region: "Maharashtra", country: "India", countryCode: "IN", latitude: 16.8524, longitude: 74.5815 },
  { city: "Akola", region: "Maharashtra", country: "India", countryCode: "IN", latitude: 20.7002, longitude: 77.0082 },
  { city: "Jalgaon", region: "Maharashtra", country: "India", countryCode: "IN", latitude: 21.0077, longitude: 75.5626 },
  { city: "Latur", region: "Maharashtra", country: "India", countryCode: "IN", latitude: 18.4088, longitude: 76.5604 },
  { city: "Satara", region: "Maharashtra", country: "India", countryCode: "IN", latitude: 17.6805, longitude: 74.0183 },
  { city: "Udaipur", region: "Rajasthan", country: "India", countryCode: "IN", latitude: 24.5854, longitude: 73.7125 },
  { city: "Ajmer", region: "Rajasthan", country: "India", countryCode: "IN", latitude: 26.4499, longitude: 74.6399 },
  { city: "Bikaner", region: "Rajasthan", country: "India", countryCode: "IN", latitude: 28.0229, longitude: 73.3119 },
  { city: "Alwar", region: "Rajasthan", country: "India", countryCode: "IN", latitude: 27.553, longitude: 76.6346 },
  { city: "Bhilwara", region: "Rajasthan", country: "India", countryCode: "IN", latitude: 25.3407, longitude: 74.6313 },
  { city: "Moradabad", region: "Uttar Pradesh", country: "India", countryCode: "IN", latitude: 28.8386, longitude: 78.7733 },
  { city: "Bareilly", region: "Uttar Pradesh", country: "India", countryCode: "IN", latitude: 28.367, longitude: 79.4304 },
  { city: "Aligarh", region: "Uttar Pradesh", country: "India", countryCode: "IN", latitude: 27.8974, longitude: 78.088 },
  { city: "Gorakhpur", region: "Uttar Pradesh", country: "India", countryCode: "IN", latitude: 26.7606, longitude: 83.3732 },
  { city: "Saharanpur", region: "Uttar Pradesh", country: "India", countryCode: "IN", latitude: 29.9675, longitude: 77.5451 },
  { city: "Jhansi", region: "Uttar Pradesh", country: "India", countryCode: "IN", latitude: 25.4484, longitude: 78.5685 },
  { city: "Mathura", region: "Uttar Pradesh", country: "India", countryCode: "IN", latitude: 27.4924, longitude: 77.6737 },
  { city: "Ayodhya", region: "Uttar Pradesh", country: "India", countryCode: "IN", latitude: 26.7922, longitude: 82.1998 },
  { city: "Jalandhar", region: "Punjab", country: "India", countryCode: "IN", latitude: 31.326, longitude: 75.5762 },
  { city: "Patiala", region: "Punjab", country: "India", countryCode: "IN", latitude: 30.3398, longitude: 76.3869 },
  { city: "Bathinda", region: "Punjab", country: "India", countryCode: "IN", latitude: 30.211, longitude: 74.9455 },
  { city: "Mohali", region: "Punjab", country: "India", countryCode: "IN", latitude: 30.7046, longitude: 76.7179 },
  { city: "Hisar", region: "Haryana", country: "India", countryCode: "IN", latitude: 29.1492, longitude: 75.7217 },
  { city: "Rohtak", region: "Haryana", country: "India", countryCode: "IN", latitude: 28.8955, longitude: 76.6066 },
  { city: "Karnal", region: "Haryana", country: "India", countryCode: "IN", latitude: 29.6857, longitude: 76.9905 },
  { city: "Panipat", region: "Haryana", country: "India", countryCode: "IN", latitude: 29.3909, longitude: 76.9635 },
  { city: "Ambala", region: "Haryana", country: "India", countryCode: "IN", latitude: 30.3782, longitude: 76.7767 },
  { city: "Shimla", region: "Himachal Pradesh", country: "India", countryCode: "IN", latitude: 31.1048, longitude: 77.1734 },
  { city: "Dharamshala", region: "Himachal Pradesh", country: "India", countryCode: "IN", latitude: 32.219, longitude: 76.3234 },
  { city: "Jammu", region: "Jammu and Kashmir", country: "India", countryCode: "IN", latitude: 32.7266, longitude: 74.857 },
  { city: "Leh", region: "Ladakh", country: "India", countryCode: "IN", latitude: 34.1526, longitude: 77.5771 },
  { city: "Jamshedpur", region: "Jharkhand", country: "India", countryCode: "IN", latitude: 22.8046, longitude: 86.2029 },
  { city: "Bokaro", region: "Jharkhand", country: "India", countryCode: "IN", latitude: 23.6693, longitude: 86.1511 },
  { city: "Muzaffarpur", region: "Bihar", country: "India", countryCode: "IN", latitude: 26.1209, longitude: 85.3647 },
  { city: "Gaya", region: "Bihar", country: "India", countryCode: "IN", latitude: 24.7914, longitude: 85.0002 },
  { city: "Bhagalpur", region: "Bihar", country: "India", countryCode: "IN", latitude: 25.2425, longitude: 86.9842 },
  { city: "Cuttack", region: "Odisha", country: "India", countryCode: "IN", latitude: 20.4625, longitude: 85.883 },
  { city: "Bhubaneswar", region: "Odisha", country: "India", countryCode: "IN", latitude: 20.2961, longitude: 85.8245 },
  { city: "Rourkela", region: "Odisha", country: "India", countryCode: "IN", latitude: 22.2604, longitude: 84.8536 },
  { city: "Sambalpur", region: "Odisha", country: "India", countryCode: "IN", latitude: 21.4669, longitude: 83.9812 },
  { city: "Durgapur", region: "West Bengal", country: "India", countryCode: "IN", latitude: 23.5204, longitude: 87.3119 },
  { city: "Asansol", region: "West Bengal", country: "India", countryCode: "IN", latitude: 23.6739, longitude: 86.9524 },
  { city: "Siliguri", region: "West Bengal", country: "India", countryCode: "IN", latitude: 26.7271, longitude: 88.3953 },
  { city: "Darjeeling", region: "West Bengal", country: "India", countryCode: "IN", latitude: 27.041, longitude: 88.2663 },
  { city: "Imphal", region: "Manipur", country: "India", countryCode: "IN", latitude: 24.817, longitude: 93.9368 },
  { city: "Shillong", region: "Meghalaya", country: "India", countryCode: "IN", latitude: 25.5788, longitude: 91.8933 },
  { city: "Aizawl", region: "Mizoram", country: "India", countryCode: "IN", latitude: 23.7271, longitude: 92.7176 },
  { city: "Kohima", region: "Nagaland", country: "India", countryCode: "IN", latitude: 25.6751, longitude: 94.1086 },
  { city: "Agartala", region: "Tripura", country: "India", countryCode: "IN", latitude: 23.8315, longitude: 91.2868 },
  { city: "Itanagar", region: "Arunachal Pradesh", country: "India", countryCode: "IN", latitude: 27.0844, longitude: 93.6053 },
  { city: "Gangtok", region: "Sikkim", country: "India", countryCode: "IN", latitude: 27.3314, longitude: 88.6138 },
  { city: "Puducherry", region: "Puducherry", country: "India", countryCode: "IN", aliases: ["pondicherry"], latitude: 11.9416, longitude: 79.8083 },
  { city: "Port Blair", region: "Andaman and Nicobar Islands", country: "India", countryCode: "IN", latitude: 11.6234, longitude: 92.7265 },
  { city: "Silvassa", region: "Dadra and Nagar Haveli and Daman and Diu", country: "India", countryCode: "IN", latitude: 20.2763, longitude: 73.0083 },
  { city: "Daman", region: "Dadra and Nagar Haveli and Daman and Diu", country: "India", countryCode: "IN", latitude: 20.3974, longitude: 72.8328 },
  { city: "Kavaratti", region: "Lakshadweep", country: "India", countryCode: "IN", latitude: 10.5593, longitude: 72.6358 },
  { city: "New York", region: "New York", country: "United States", countryCode: "US", latitude: 40.7128, longitude: -74.006 },
  { city: "Los Angeles", region: "California", country: "United States", countryCode: "US", latitude: 34.0522, longitude: -118.2437 },
  { city: "San Francisco", region: "California", country: "United States", countryCode: "US", latitude: 37.7749, longitude: -122.4194 },
  { city: "Austin", region: "Texas", country: "United States", countryCode: "US", latitude: 30.2672, longitude: -97.7431 },
  { city: "Chicago", region: "Illinois", country: "United States", countryCode: "US", latitude: 41.8781, longitude: -87.6298 },
  { city: "Seattle", region: "Washington", country: "United States", countryCode: "US", latitude: 47.6062, longitude: -122.3321 },
  { city: "Toronto", region: "Ontario", country: "Canada", countryCode: "CA", latitude: 43.6532, longitude: -79.3832 },
  { city: "Vancouver", region: "British Columbia", country: "Canada", countryCode: "CA", latitude: 49.2827, longitude: -123.1207 },
  { city: "London", region: "England", country: "United Kingdom", countryCode: "GB", latitude: 51.5072, longitude: -0.1276 },
  { city: "Manchester", region: "England", country: "United Kingdom", countryCode: "GB", latitude: 53.4808, longitude: -2.2426 },
  { city: "Berlin", region: "Berlin", country: "Germany", countryCode: "DE", latitude: 52.52, longitude: 13.405 },
  { city: "Paris", region: "Ile-de-France", country: "France", countryCode: "FR", latitude: 48.8566, longitude: 2.3522 },
  { city: "Amsterdam", region: "North Holland", country: "Netherlands", countryCode: "NL", latitude: 52.3676, longitude: 4.9041 },
  { city: "Madrid", region: "Community of Madrid", country: "Spain", countryCode: "ES", latitude: 40.4168, longitude: -3.7038 },
  { city: "Barcelona", region: "Catalonia", country: "Spain", countryCode: "ES", latitude: 41.3874, longitude: 2.1686 },
  { city: "Dubai", region: "Dubai", country: "United Arab Emirates", countryCode: "AE", latitude: 25.2048, longitude: 55.2708 },
  { city: "Singapore", region: "Singapore", country: "Singapore", countryCode: "SG", latitude: 1.3521, longitude: 103.8198 },
  { city: "Sydney", region: "New South Wales", country: "Australia", countryCode: "AU", latitude: -33.8688, longitude: 151.2093 },
  { city: "Melbourne", region: "Victoria", country: "Australia", countryCode: "AU", latitude: -37.8136, longitude: 144.9631 },
  { city: "Tokyo", region: "Tokyo", country: "Japan", countryCode: "JP", latitude: 35.6762, longitude: 139.6503 },
  { city: "Seoul", region: "Seoul", country: "South Korea", countryCode: "KR", latitude: 37.5665, longitude: 126.978 },
  { city: "Boston", region: "Massachusetts", country: "United States", countryCode: "US", latitude: 42.3601, longitude: -71.0589 },
  { city: "Miami", region: "Florida", country: "United States", countryCode: "US", latitude: 25.7617, longitude: -80.1918 },
  { city: "Atlanta", region: "Georgia", country: "United States", countryCode: "US", latitude: 33.749, longitude: -84.388 },
  { city: "Denver", region: "Colorado", country: "United States", countryCode: "US", latitude: 39.7392, longitude: -104.9903 },
  { city: "Portland", region: "Oregon", country: "United States", countryCode: "US", latitude: 45.5152, longitude: -122.6784 },
  { city: "Dallas", region: "Texas", country: "United States", countryCode: "US", latitude: 32.7767, longitude: -96.797 },
  { city: "Houston", region: "Texas", country: "United States", countryCode: "US", latitude: 29.7604, longitude: -95.3698 },
  { city: "Phoenix", region: "Arizona", country: "United States", countryCode: "US", latitude: 33.4484, longitude: -112.074 },
  { city: "Montreal", region: "Quebec", country: "Canada", countryCode: "CA", latitude: 45.5019, longitude: -73.5674 },
  { city: "Calgary", region: "Alberta", country: "Canada", countryCode: "CA", latitude: 51.0447, longitude: -114.0719 },
  { city: "Ottawa", region: "Ontario", country: "Canada", countryCode: "CA", latitude: 45.4215, longitude: -75.6972 },
  { city: "Dublin", region: "Leinster", country: "Ireland", countryCode: "IE", latitude: 53.3498, longitude: -6.2603 },
  { city: "Edinburgh", region: "Scotland", country: "United Kingdom", countryCode: "GB", latitude: 55.9533, longitude: -3.1883 },
  { city: "Glasgow", region: "Scotland", country: "United Kingdom", countryCode: "GB", latitude: 55.8642, longitude: -4.2518 },
  { city: "Birmingham", region: "England", country: "United Kingdom", countryCode: "GB", latitude: 52.4862, longitude: -1.8904 },
  { city: "Rome", region: "Lazio", country: "Italy", countryCode: "IT", latitude: 41.9028, longitude: 12.4964 },
  { city: "Milan", region: "Lombardy", country: "Italy", countryCode: "IT", latitude: 45.4642, longitude: 9.19 },
  { city: "Lisbon", region: "Lisbon", country: "Portugal", countryCode: "PT", latitude: 38.7223, longitude: -9.1393 },
  { city: "Zurich", region: "Zurich", country: "Switzerland", countryCode: "CH", latitude: 47.3769, longitude: 8.5417 },
  { city: "Stockholm", region: "Stockholm County", country: "Sweden", countryCode: "SE", latitude: 59.3293, longitude: 18.0686 },
  { city: "Copenhagen", region: "Capital Region", country: "Denmark", countryCode: "DK", latitude: 55.6761, longitude: 12.5683 },
  { city: "Oslo", region: "Oslo", country: "Norway", countryCode: "NO", latitude: 59.9139, longitude: 10.7522 },
  { city: "Helsinki", region: "Uusimaa", country: "Finland", countryCode: "FI", latitude: 60.1699, longitude: 24.9384 },
  { city: "Prague", region: "Prague", country: "Czech Republic", countryCode: "CZ", latitude: 50.0755, longitude: 14.4378 },
  { city: "Vienna", region: "Vienna", country: "Austria", countryCode: "AT", latitude: 48.2082, longitude: 16.3738 },
  { city: "Warsaw", region: "Masovian Voivodeship", country: "Poland", countryCode: "PL", latitude: 52.2297, longitude: 21.0122 },
  { city: "Istanbul", region: "Istanbul", country: "Turkey", countryCode: "TR", latitude: 41.0082, longitude: 28.9784 },
  { city: "Tel Aviv", region: "Tel Aviv District", country: "Israel", countryCode: "IL", latitude: 32.0853, longitude: 34.7818 },
  { city: "Doha", region: "Doha", country: "Qatar", countryCode: "QA", latitude: 25.2854, longitude: 51.531 },
  { city: "Riyadh", region: "Riyadh", country: "Saudi Arabia", countryCode: "SA", latitude: 24.7136, longitude: 46.6753 },
  { city: "Bangkok", region: "Bangkok", country: "Thailand", countryCode: "TH", latitude: 13.7563, longitude: 100.5018 },
  { city: "Jakarta", region: "Jakarta", country: "Indonesia", countryCode: "ID", latitude: -6.2088, longitude: 106.8456 },
  { city: "Kuala Lumpur", region: "Kuala Lumpur", country: "Malaysia", countryCode: "MY", latitude: 3.139, longitude: 101.6869 },
  { city: "Manila", region: "Metro Manila", country: "Philippines", countryCode: "PH", latitude: 14.5995, longitude: 120.9842 },
  { city: "Ho Chi Minh City", region: "Ho Chi Minh City", country: "Vietnam", countryCode: "VN", aliases: ["saigon"], latitude: 10.8231, longitude: 106.6297 },
  { city: "Hong Kong", region: "Hong Kong", country: "Hong Kong", countryCode: "HK", latitude: 22.3193, longitude: 114.1694 },
  { city: "Taipei", region: "Taipei", country: "Taiwan", countryCode: "TW", latitude: 25.033, longitude: 121.5654 },
  { city: "Auckland", region: "Auckland", country: "New Zealand", countryCode: "NZ", latitude: -36.8509, longitude: 174.7645 },
  { city: "Brisbane", region: "Queensland", country: "Australia", countryCode: "AU", latitude: -27.4698, longitude: 153.0251 },
  { city: "Perth", region: "Western Australia", country: "Australia", countryCode: "AU", latitude: -31.9523, longitude: 115.8613 },
  { city: "Cape Town", region: "Western Cape", country: "South Africa", countryCode: "ZA", latitude: -33.9249, longitude: 18.4241 },
  { city: "Johannesburg", region: "Gauteng", country: "South Africa", countryCode: "ZA", latitude: -26.2041, longitude: 28.0473 },
  { city: "Lagos", region: "Lagos", country: "Nigeria", countryCode: "NG", latitude: 6.5244, longitude: 3.3792 },
  { city: "Nairobi", region: "Nairobi County", country: "Kenya", countryCode: "KE", latitude: -1.2921, longitude: 36.8219 },
  { city: "Cairo", region: "Cairo Governorate", country: "Egypt", countryCode: "EG", latitude: 30.0444, longitude: 31.2357 },
  { city: "Sao Paulo", region: "Sao Paulo", country: "Brazil", countryCode: "BR", latitude: -23.5558, longitude: -46.6396 },
  { city: "Rio de Janeiro", region: "Rio de Janeiro", country: "Brazil", countryCode: "BR", latitude: -22.9068, longitude: -43.1729 },
  { city: "Mexico City", region: "Mexico City", country: "Mexico", countryCode: "MX", latitude: 19.4326, longitude: -99.1332 },
  { city: "Buenos Aires", region: "Buenos Aires", country: "Argentina", countryCode: "AR", latitude: -34.6037, longitude: -58.3816 },
  { city: "Santiago", region: "Santiago Metropolitan Region", country: "Chile", countryCode: "CL", latitude: -33.4489, longitude: -70.6693 },
  { city: "Bogota", region: "Bogota", country: "Colombia", countryCode: "CO", latitude: 4.711, longitude: -74.0721 },
  { city: "Lima", region: "Lima Province", country: "Peru", countryCode: "PE", latitude: -12.0464, longitude: -77.0428 },
];

const normalizeSearchText = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s,.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const slugify = (value: string) => normalizeSearchText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const displayNameFor = (location: LocalLocationRecord) =>
  [location.city, location.region, location.country].filter(Boolean).join(", ");

const placeIdFor = (location: LocalLocationRecord) =>
  `${LOCAL_PLACE_PREFIX}${slugify([location.city, location.region, location.countryCode].join("-"))}`;

const toDetails = (location: LocalLocationRecord): LocationDetails => ({
  placeId: placeIdFor(location),
  displayName: displayNameFor(location),
  city: location.city,
  region: location.region,
  country: location.country,
  countryCode: location.countryCode,
  ...(typeof location.latitude === "number" ? { latitude: location.latitude } : {}),
  ...(typeof location.longitude === "number" ? { longitude: location.longitude } : {}),
});

export const localLocationToSuggestion = (location: LocalLocationRecord): LocationAutocompleteSuggestion => ({
  placeId: placeIdFor(location),
  displayName: displayNameFor(location),
  primaryText: location.city,
  secondaryText: [location.region, location.country].filter(Boolean).join(", "),
});

export const isLocalLocationPlaceId = (placeId: string) => placeId.startsWith(LOCAL_PLACE_PREFIX);

export const getLocalLocationByPlaceId = (placeId: string): LocationDetails | null => {
  const match = LOCAL_LOCATIONS.find((location) => placeIdFor(location) === placeId);
  return match ? toDetails(match) : null;
};

export const findLocalLocationByDisplayName = (value: string): LocationDetails | null => {
  const normalized = normalizeSearchText(value);
  if (!normalized) return null;

  const match = LOCAL_LOCATIONS.find((location) => normalizeSearchText(displayNameFor(location)) === normalized);
  return match ? toDetails(match) : null;
};

export const searchLocalLocations = (query: string, limit = 6): LocationAutocompleteSuggestion[] => {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length < 2) return [];

  return LOCAL_LOCATIONS.map((location, index) => {
    const displayName = displayNameFor(location);
    const haystacks = [location.city, location.region, location.country, displayName, ...(location.aliases || [])].map(
      normalizeSearchText
    );
    const startsWithCity = normalizeSearchText(location.city).startsWith(normalizedQuery);
    const startsWithAlias = (location.aliases || []).some((alias) => normalizeSearchText(alias).startsWith(normalizedQuery));
    const startsWithRegion = normalizeSearchText(location.region).startsWith(normalizedQuery);
    const includesMatch = haystacks.some((value) => value.includes(normalizedQuery));

    if (!startsWithCity && !startsWithAlias && !startsWithRegion && !includesMatch) return null;

    const countryBias = location.countryCode === "IN" ? -25 : 0;
    const rank =
      (startsWithCity ? 0 : startsWithAlias ? 1 : startsWithRegion ? 2 : 4) * 100 +
      countryBias +
      index / 1000;

    return { location, rank };
  })
    .filter((item): item is { location: LocalLocationRecord; rank: number } => Boolean(item))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, limit)
    .map((item) => localLocationToSuggestion(item.location));
};
