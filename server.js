import http from 'http'
import fs from 'fs'

const server = http.createServer((req,res) => {
    
    let html = fs.readFileSync('./index.html').toString('utf-8')
    res.end(html)

})

server.listen(3000,async () => {
    console.log('server running on 3000')
})