import http from 'http';

http.get('http://localhost:3000/', (res) => {
  console.log('HEADERS:', res.headers);
});
